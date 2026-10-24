// Positive and negative tests for the test-token release guard. Synthetic
// fixtures only: contract IDs are placeholders, not deployments.
//   node --test scripts/lib/test-token-guard.test.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  PUBLIC_PASSPHRASE,
  STANDALONE_PASSPHRASE,
  TEST_PASSPHRASE,
  checkDocument,
  checkManifest,
  checkRelease,
  classifyLabel,
} from "./test-token-guard.mjs";

const lbt = { code: "LBT", decimals: 7, purpose: "Custom test-only token; not USDC" };
const withTestToken = (labels) => ({
  ...labels,
  contracts: {
    "upto-session": { contractId: "C-SYNTHETIC-ESCROW" },
    "test-token": { contractId: "C-SYNTHETIC-LBT", asset: lbt },
  },
});
const withoutTestToken = (labels) => ({
  ...labels,
  contracts: { "upto-session": { contractId: "C-SYNTHETIC-ESCROW" } },
});

test("a testnet manifest with test-token passes", () => {
  assert.deepEqual(
    checkManifest(
      withTestToken({
        environment: "testnet",
        network: { name: "Test SDF Network", passphrase: TEST_PASSPHRASE },
      }),
      "testnet.json",
    ),
    [],
  );
});

test("a local manifest with test-token passes", () => {
  assert.deepEqual(checkManifest(withTestToken({ network: "local" }), "local.json"), []);
  assert.deepEqual(
    checkManifest(withTestToken({ networkPassphrase: STANDALONE_PASSPHRASE }), "standalone.json"),
    [],
  );
});

test("per-contract testnet labels pass (example manifest shape)", () => {
  const manifest = {
    contracts: {
      "test-token": { name: "test-token", network: "testnet", wasm: "target/wasm32v1-none/release/test_token.wasm" },
    },
  };
  assert.deepEqual(checkManifest(manifest, "testnet.example.json"), []);
});

test("pubnet and production manifests without test-token pass", () => {
  for (const labels of [
    { environment: "pubnet" },
    { environment: "production", network: { passphrase: PUBLIC_PASSPHRASE } },
  ]) {
    assert.deepEqual(checkManifest(withoutTestToken(labels), "prod.json"), []);
  }
});

for (const label of ["pubnet", "public", "mainnet", "production", "prod"]) {
  test(`test-token under a "${label}" label fails`, () => {
    const violations = checkManifest(withTestToken({ environment: label }), `${label}.json`);
    assert.equal(violations.length, 1);
    assert.match(violations[0], /production label/);
    assert.match(violations[0], new RegExp(`${label}\\.json`));
  });
}

for (const label of ["PubNet", "  MAINNET ", "Production\t", "pro d", "public network", " prod "]) {
  test(`mixed-case and whitespace variant ${JSON.stringify(label)} fails`, () => {
    assert.notDeepEqual(checkManifest(withTestToken({ environment: label }), "variant.json"), []);
  });
}

test("the public network passphrase fails, including whitespace variants", () => {
  for (const passphrase of [PUBLIC_PASSPHRASE, `  public global stellar network ;   september 2015 `]) {
    const violations = checkManifest(withTestToken({ network: { passphrase } }), "passphrase.json");
    assert.equal(violations.length, 1);
    assert.match(violations[0], /production label/);
  }
});

test("a testnet environment with a public passphrase still fails", () => {
  const violations = checkManifest(
    withTestToken({ environment: "testnet", network: { passphrase: PUBLIC_PASSPHRASE } }),
    "mixed.json",
  );
  assert.equal(violations.length, 1);
});

test("an unknown label with test-token fails closed", () => {
  for (const label of ["futurenet", "staging", "qa", "testnet2", ""]) {
    const violations = checkManifest(withTestToken({ environment: label }), "unknown.json");
    assert.equal(violations.length, 1, label);
    assert.match(violations[0], /unrecognized \(treated as production\)/);
  }
});

test("a missing label with test-token fails closed", () => {
  const violations = checkManifest(withTestToken({}), "unlabeled.json");
  assert.equal(violations.length, 1);
  assert.match(violations[0], /no network or environment label/);
});

test("test-token is detected by key, artifact name and asset code", () => {
  for (const manifest of [
    { environment: "mainnet", contracts: { test_token: {} } },
    { environment: "mainnet", artifacts: ["test_token.wasm"] },
    { environment: "mainnet", asset: { code: "LBT" } },
  ]) {
    assert.notDeepEqual(checkManifest(manifest, "detect.json"), []);
  }
});

test("error messages say LBT is not USDC and name the file, label and fix", () => {
  const [message] = checkManifest(withTestToken({ environment: "pubnet" }), "deployments/pubnet.json");
  assert.match(message, /LBT/);
  assert.match(message, /not USDC/i);
  assert.match(message, /deployments\/pubnet\.json/);
  assert.match(message, /"pubnet"/);
  assert.match(message, /Remove test-token from this production manifest, or correct the label/);
});

test("release artifact lists follow the same rules", () => {
  assert.deepEqual(checkRelease({ label: "testnet", artifacts: ["test_token.wasm", "upto_session.wasm"] }), []);
  assert.deepEqual(checkRelease({ label: "production", artifacts: ["upto_session.wasm"] }), []);
  assert.match(checkRelease({ label: "production", artifacts: ["test_token.wasm"] }).join(), /not USDC/i);
  assert.match(checkRelease({ artifacts: ["test_token.wasm"] }).join(), /no network or environment label/);
  assert.notDeepEqual(checkRelease({ label: "testnet" }), []);
});

test("affirmative USDC claims about LBT fail; negated ones pass", () => {
  assert.match(
    checkManifest({ environment: "testnet", asset: { code: "LBT", purpose: "LBT is USDC on testnet" } }, "claim.json").join(),
    /presents LBT as USDC/,
  );
  assert.deepEqual(checkManifest({ environment: "testnet", asset: lbt }, "ok.json"), []);
  assert.deepEqual(checkDocument("LBT is a custom test-only token. It is not Circle USDC.\n", "ok.md"), []);
  assert.match(checkDocument("Intro.\n\nLBT is the production asset for payments.\n", "bad.md").join(), /bad\.md:3/);
  assert.match(checkDocument("The test-token behaves as USDC.\n", "bad.md").join(), /not USDC/i);
  // Wrapped Markdown is judged per sentence, not per physical line.
  assert.deepEqual(checkDocument("Errors state that LBT is a test-only token and not\nUSDC, and name `test-token`.\n", "wrap.md"), []);
  assert.match(checkDocument("# Title\n\nSome text.\nLBT is\nUSDC on testnet.\n", "wrap.md").join(), /wrap\.md:3/);
});

test("label classification", () => {
  assert.equal(classifyLabel(" TestNet "), "non-production");
  assert.equal(classifyLabel("LOCAL"), "non-production");
  assert.equal(classifyLabel(TEST_PASSPHRASE.toUpperCase()), "non-production");
  assert.equal(classifyLabel("testnet-public"), "production");
  assert.equal(classifyLabel("devnet"), "unknown");
});

test("the CLI rejects a production manifest and passes a testnet one", () => {
  const script = fileURLToPath(new URL("../check-test-token-guard.mjs", import.meta.url));
  const dir = mkdtempSync(join(tmpdir(), "test-token-guard-"));
  const good = join(dir, "testnet.json");
  const bad = join(dir, "mainnet.json");
  writeFileSync(good, JSON.stringify(withTestToken({ environment: "testnet" })));
  writeFileSync(bad, JSON.stringify(withTestToken({ environment: "mainnet" })));
  execFileSync(process.execPath, [script, "--manifest", good], { stdio: "pipe" });
  assert.throws(
    () => execFileSync(process.execPath, [script, "--manifest", good, "--manifest", bad], { stdio: "pipe" }),
    (error) => error.status === 1 && /NOT USDC/.test(error.stderr.toString()),
  );
  assert.throws(
    () => execFileSync(process.execPath, [script, "--release-label", "prod", "--artifact", "test_token.wasm"], { stdio: "pipe" }),
    (error) => error.status === 1,
  );
});
