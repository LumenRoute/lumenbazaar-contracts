import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  METHOD_METADATA,
  formatSpecType,
  generateBindingApiReference,
  loadBindingApiInputs,
} from "./binding-api-reference.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("generated README matches committed bindings/upto-session/README.md with zero drift", () => {
  const inputs = loadBindingApiInputs(repoRoot);
  const generated = generateBindingApiReference(inputs);
  const committed = readFileSync(
    join(repoRoot, "bindings", "upto-session", "README.md"),
    "utf8",
  ).replace(/\r\n/g, "\n");
  assert.equal(
    committed,
    generated,
    "bindings/upto-session/README.md drifted from frozen spec; run `node scripts/generate-bindings.mjs --skip-build`",
  );
});

test("all public methods, types, errors, and events from frozen spec and v3 fixture are represented", () => {
  const inputs = loadBindingApiInputs(repoRoot);
  const markdown = generateBindingApiReference(inputs);

  for (const method of inputs.v3Fixture.methods) {
    assert.match(markdown, new RegExp(`\\| \`${method}\` \\|`), `missing method ${method}`);
  }

  for (const entry of inputs.spec) {
    const typeName =
      entry.udt_struct_v0?.name ??
      entry.udt_enum_v0?.name ??
      entry.udt_union_v0?.name ??
      null;
    if (typeName) {
      assert.match(markdown, new RegExp(`\\| \`${typeName}\` \\|`), `missing type ${typeName}`);
    }
  }

  for (const err of inputs.v3Fixture.errors) {
    assert.match(
      markdown,
      new RegExp(`\\| ${err.value} \\| \`${err.name}\` \\|`),
      `missing error ${err.value} (${err.name})`,
    );
  }

  for (const ev of inputs.v3Fixture.events) {
    assert.match(markdown, new RegExp(`\\| \`${ev.name}\` \\|`), `missing event ${ev.name}`);
  }
});

test("security-sensitive methods link to authorization and lifecycle notes and unsupported networks fail closed", () => {
  const inputs = loadBindingApiInputs(repoRoot);
  const markdown = generateBindingApiReference(inputs);

  const securitySensitiveMethods = [
    "initialize",
    "create_session",
    "settle",
    "cancel",
    "reject",
    "reduce_session_cap",
    "extend_session_expiry",
    "recover_expired",
    "recover_expired_batch",
    "recover_surplus",
    "extend_ttl",
    "activate_asset",
    "deprecate_asset",
    "remove_asset",
    "set_asset_max_session_amount",
    "propose_asset_cap_increase",
    "accept_asset_cap_increase",
    "cancel_asset_cap_increase",
    "set_asset_exposure_ceiling",
    "set_buyer_exposure_ceiling",
    "set_seller_exposure_ceiling",
    "set_max_buyer_open_sessions",
    "set_max_seller_open_sessions",
    "propose_admin",
    "accept_admin",
    "cancel_admin_rotation",
    "pause_creation",
    "resume_creation",
  ];

  for (const method of securitySensitiveMethods) {
    assert.equal(
      METHOD_METADATA[method]?.securitySensitive,
      true,
      `${method} must be marked securitySensitive`,
    );
    const rowPattern = new RegExp(`\\| \`${method}\` \\|[^\\n]*\\*\\*\\[Security-Sensitive\\]\\*\\*[^\\n]*\\.md`);
    assert.match(markdown, rowPattern, `${method} row must include [Security-Sensitive] badge and doc links`);
  }

  // Must not contain generic CLI placeholder boilerplate or promise unsupported networks
  assert.doesNotMatch(markdown, /INSERT_RPC_URL_HERE/);
  assert.doesNotMatch(markdown, /networks\.futurenet/);
  assert.match(markdown, /pubnet.*unsupported/i);
  assert.match(markdown, /<!-- lumenbazaar:transaction-evidence/);
});

test("generator fails closed on spec/fixture mismatch or drifted error/event sets", () => {
  const inputs = loadBindingApiInputs(repoRoot);

  // 1. Mismatched spec SHA-256
  assert.throws(
    () =>
      generateBindingApiReference({
        ...inputs,
        specSha256: "0".repeat(64),
      }),
    /sourceSpecSha256.*does not match/,
  );

  // 2. Method drift between spec and v3 fixture
  assert.throws(
    () =>
      generateBindingApiReference({
        ...inputs,
        v3Fixture: {
          ...inputs.v3Fixture,
          methods: inputs.v3Fixture.methods.filter((m) => m !== "settle"),
        },
      }),
    /Public methods in frozen spec do not match/,
  );

  // 3. Error drift between spec and v3 fixture
  assert.throws(
    () =>
      generateBindingApiReference({
        ...inputs,
        v3Fixture: {
          ...inputs.v3Fixture,
          errors: inputs.v3Fixture.errors.slice(0, -1),
        },
      }),
    /ContractError cases in frozen spec do not match/,
  );

  // 4. Event drift between spec and v3 fixture
  assert.throws(
    () =>
      generateBindingApiReference({
        ...inputs,
        v3Fixture: {
          ...inputs.v3Fixture,
          events: inputs.v3Fixture.events.slice(0, -1),
        },
      }),
    /Events in frozen spec do not match/,
  );

  assert.equal(formatSpecType({ bytes_n: { n: 32 } }), "BytesN<32> (Buffer)");
  assert.equal(formatSpecType({ option: { value_type: "u32" } }), "Option<u32 (number)>");
});
