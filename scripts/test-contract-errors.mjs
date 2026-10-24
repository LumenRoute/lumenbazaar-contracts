// Unit tests for the typed contract error decoder shipped in the TypeScript
// binding (scripts/templates/contractErrors.ts) and for the drift guard used by
// scripts/generate-bindings.mjs. Run after building the binding:
//   npm --prefix bindings/upto-session run build
//   node --test scripts/test-contract-errors.mjs
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  assertErrorMapMatchesFixture,
  diffErrorMaps,
  readTemplateErrors,
} from "./lib/contract-error-map.mjs";

const bindings = await import("../bindings/upto-session/dist/index.js");
const { CONTRACT_ERROR_CODES, CONTRACT_ERROR_NAMES, decodeContractError, isContractError } =
  bindings;
const templatePath = new URL("./templates/contractErrors.ts", import.meta.url).pathname;
const fixturePath = new URL("../artifacts/interface/upto-session-v3.json", import.meta.url)
  .pathname;
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));

test("every frozen contract error code has exactly one typed name", () => {
  assert.equal(Object.keys(CONTRACT_ERROR_CODES).length, fixture.errors.length);
  for (const { name, value } of fixture.errors) {
    assert.equal(CONTRACT_ERROR_CODES[name], value, name);
    assert.equal(CONTRACT_ERROR_NAMES[value], name, String(value));
    // The CLI-generated map agrees with the typed one.
    assert.equal(bindings.ContractError[value].message, name);
  }
});

test("decodes host contract errors from simulation and transaction text", () => {
  const simulation =
    "HostError: Error(Contract, #5)\n\nEvent log (newest first):\n   0: [Diagnostic Event] ...";
  assert.deepEqual(decodeContractError(simulation), {
    kind: "contract",
    code: 5,
    name: "SessionNotFound",
    cause: simulation,
  });

  const thrown = new Error(
    'Transaction simulation failed: "HostError: Error(Contract, #38)"',
  );
  const decoded = decodeContractError(thrown);
  assert.equal(decoded.kind, "contract");
  assert.equal(decoded.name, "AssetLimitReached");
  assert.equal(decoded.cause, thrown, "the original error is preserved");
});

test("decodes RPC simulation responses and nested causes", () => {
  const response = {
    error: "HostError: Error(Contract, #22)",
    events: [],
    latestLedger: 123,
  };
  assert.equal(decodeContractError(response).name, "SessionNotExpired");

  const wrapped = new Error("send failed", {
    cause: new Error("Error(Contract, #2)"),
  });
  assert.equal(decodeContractError(wrapped).name, "Unauthorized");
  assert.equal(isContractError(wrapped, "Unauthorized"), true);
  assert.equal(isContractError(wrapped, "InvalidAmount"), false);
});

test("decodes the binding's Result error values", () => {
  const err = new bindings.contract.Err(bindings.ContractError[37]);
  const decoded = decodeContractError(err);
  assert.equal(decoded.kind, "contract");
  assert.equal(decoded.code, 37);
  assert.equal(decoded.name, "AssetDeprecated");
  assert.equal(decodeContractError({ message: "AssetAlreadyActive" }).code, 36);
});

test("keeps unknown and malformed contract errors distinguishable", () => {
  assert.deepEqual(decodeContractError("HostError: Error(Contract, #99)"), {
    kind: "unknown_contract",
    code: 99,
    cause: "HostError: Error(Contract, #99)",
  });
  for (const raw of ["abc", "", "-1", "1.5", "99999999999", "4294967296"]) {
    const decoded = decodeContractError(`HostError: Error(Contract, #${raw})`);
    assert.equal(decoded.kind, "malformed_contract", raw);
    assert.equal(decoded.raw, raw);
  }
  assert.equal(decodeContractError("Error(Contract, #4294967295)").kind, "unknown_contract");
  // A plain object naming an unknown error is not a contract error.
  assert.equal(decodeContractError({ message: "NotAnError" }).kind, "other");
});

test("does not turn host, transport or RPC failures into contract errors", () => {
  assert.deepEqual(decodeContractError("HostError: Error(Auth, InvalidAction)"), {
    kind: "host",
    type: "Auth",
    detail: "InvalidAction",
    cause: "HostError: Error(Auth, InvalidAction)",
  });
  assert.equal(decodeContractError("Error(Budget, ExceededLimit)").type, "Budget");

  const transport = new TypeError("fetch failed");
  assert.deepEqual(decodeContractError(transport), { kind: "other", cause: transport });
  // An HTTP 401 whose message matches a contract error name stays a transport error.
  assert.equal(decodeContractError(new Error("Unauthorized")).kind, "other");
  const rpc = { code: -32601, message: "method not found" };
  assert.deepEqual(decodeContractError(rpc), { kind: "other", cause: rpc });
  const rpcNamedLikeContract = { code: 401, message: "Unauthorized" };
  assert.equal(decodeContractError(rpcNamedLikeContract).kind, "other");
  for (const value of [undefined, null, 42, true, {}, []]) {
    assert.equal(decodeContractError(value).kind, "other");
  }
});

test("stops on self-referencing and deeply nested errors", () => {
  const loop = new Error("outer");
  loop.cause = loop;
  assert.equal(decodeContractError(loop).kind, "other");

  let deep = new Error("Error(Contract, #5)");
  for (let i = 0; i < 10; i += 1) {
    deep = new Error("wrapper", { cause: deep });
  }
  assert.equal(decodeContractError(deep).kind, "other");
});

test("the template error map matches the interface fixture", () => {
  assert.deepEqual(readTemplateErrors(templatePath), fixture.errors);
  assert.doesNotThrow(() => assertErrorMapMatchesFixture(templatePath, fixturePath));
});

test("binding generation fails when the error map drifts", () => {
  const errors = fixture.errors;
  assert.deepEqual(diffErrorMaps(errors.slice(0, -1), errors), [
    `missing ${errors.at(-1).name}=${errors.at(-1).value}`,
  ]);
  assert.match(
    diffErrorMaps(
      errors.map((e) => (e.value === 5 ? { ...e, value: 50 } : e)),
      errors,
    ).join(),
    /SessionNotFound is 50 in the binding but 5 in the fixture/,
  );
  assert.deepEqual(diffErrorMaps([...errors, { name: "Extra", value: 99 }], errors), [
    "unexpected Extra=99",
  ]);
  assert.match(
    diffErrorMaps([...errors, { name: "Alias", value: 5 }], errors).join(),
    /duplicate error codes/,
  );

  const dir = mkdtempSync(join(tmpdir(), "contract-errors-"));
  const drifted = join(dir, "contractErrors.ts");
  writeFileSync(
    drifted,
    readFileSync(templatePath, "utf8").replace("  AssetLimitReached: 38,\n", ""),
  );
  assert.throws(
    () => assertErrorMapMatchesFixture(drifted, fixturePath),
    /drifted[\s\S]*missing AssetLimitReached=38/,
  );
});
