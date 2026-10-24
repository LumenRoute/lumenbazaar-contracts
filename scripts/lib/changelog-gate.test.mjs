import assert from "node:assert/strict";
import test from "node:test";
import { checkChangelog, contractFacingChanges, productionRust } from "./changelog-gate.mjs";
const entry = (category = "Fixed", impact = "compatible", migration = "none") =>
  `## Unreleased\n\n### ${category}\n\n- Describe the change. Compatibility: ${impact}. Migration: ${migration}.\n\n## v0.1.0\n`;
const change = (path) => ({ path, before: "old", after: "new" });
test("public methods, errors, events, bindings and deployment changes trigger the gate", () => {
  for (const path of ["contracts/upto-session/src/lib.rs", "contracts/upto-session/src/error.rs",
    "contracts/upto-session/src/events.rs", "artifacts/spec/upto-session.json", "artifacts/interface/upto-session-v3.json",
    "bindings/upto-session/src/index.ts", "deployments/testnet.example.json", "scripts/testnet/deploy-testnet.mjs",
    "scripts/local/initialize-local.mjs", "scripts/lib/stellar-cli.mjs"]) {
    assert.deepEqual(contractFacingChanges([change(path)]), [path]);
    assert.ok(checkChangelog({ changes: [change(path)], beforeChangelog: "", changelog: "" }).errors.length);
  }
});
test("test-only refactors do not require release notes", () => {
  assert.deepEqual(contractFacingChanges([change("contracts/upto-session/src/tests.rs"), change("scripts/lib/tool.test.mjs")]), []);
  const source = 'pub fn live() {}\n#[cfg(test)]\nmod tests { fn fixture() { let text = "}"; } }';
  assert.equal(productionRust(source), productionRust(source.replace("fixture", "new_fixture")));
  assert.deepEqual(contractFacingChanges([{ path: "contracts/x/src/lib.rs", before: source, after: source.replace("fixture", "new_fixture") }]), []);
});
test("all supported categories require compatibility and migration descriptions", () => {
  for (const category of ["Added", "Changed", "Fixed", "Security"]) {
    assert.deepEqual(checkChangelog({ changes: [change("deployments/example.json")], beforeChangelog: "", changelog: entry(category) }).errors, []);
  }
  assert.ok(checkChangelog({ changes: [change("deployments/example.json")], beforeChangelog: "", changelog: "## Unreleased\n- A fix\n" }).errors.length >= 3);
});
test("an unchanged changelog entry cannot satisfy a new change", () => {
  assert.ok(checkChangelog({ changes: [change("deployments/example.json")], beforeChangelog: entry(), changelog: entry() }).errors.length);
});
test("breaking work needs an existing safe migration reference", () => {
  const args = { changes: [change("artifacts/spec/upto-session.json")], beforeChangelog: "", breaking: true,
    exists: (path) => path === "docs/migration.md" };
  assert.ok(checkChangelog({ ...args, changelog: entry("Breaking", "breaking", "none") }).errors.length);
  assert.deepEqual(checkChangelog({ ...args, changelog: entry("Breaking", "breaking", "[replacement contract](docs/migration.md)") }).errors, []);
  assert.ok(checkChangelog({ ...args, changelog: entry("Breaking", "breaking", "[escape](docs/../../file)") }).errors.length);
  assert.ok(checkChangelog({ ...args, changelog: entry("Fixed", "compatible", "none") }).errors.length);
});
test("deletion of a contract-facing file still requires notes", () => {
  assert.ok(checkChangelog({ changes: [{ path: "contracts/x/src/errors.rs", before: "pub enum E {}", after: "" }], beforeChangelog: "", changelog: "" }).errors.length);
});
