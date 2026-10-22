import assert from "node:assert/strict";
import test from "node:test";
import { checkReleaseVersions } from "./release-versions.mjs";

function fixture(kind) {
  const previous = { crates: { "upto-session": "0.2.0", "test-token": "0.1.0", "policy-wallet-example": "0.1.0" },
    interfaceVersion: 2, storageLayoutVersion: 2, bindingVersion: "2.0.0", deploymentSchemaVersion: 2 };
  const expected = structuredClone(previous);
  expected.crates["upto-session"] = kind === "patch" ? "0.2.1" : "0.3.0";
  expected.bindingVersion = { patch: "2.0.1", additive: "2.1.0", migration: "3.0.0" }[kind];
  if (kind === "migration") { expected.interfaceVersion = 3; expected.storageLayoutVersion = 3; }
  const plan = { schemaVersion: 1, baselineTag: "v0.2.0", releaseVersion: expected.crates["upto-session"], previous, expected, kind };
  const actual = { ...structuredClone(expected), lockCrates: structuredClone(expected.crates),
    bindingLockVersion: expected.bindingVersion, generatorBindingVersion: expected.bindingVersion };
  const options = { changelog: "## Unreleased\n", abi: { additive: kind === "additive" ? ["method added"] : [], breaking: kind === "migration" ? ["storage changed"] : [] },
    migration: { fromInterfaceVersion: 2, toInterfaceVersion: 3, baselineReleaseTag: "v0.2.0", compatibilityNotes: ["replacement contract"] } };
  return { plan, actual, options };
}
for (const kind of ["patch", "additive", "migration"]) {
  test(`${kind} release maps independently versioned artifacts`, () => {
    const { plan, actual, options } = fixture(kind);
    assert.deepEqual(checkReleaseVersions(plan, actual, options), []);
  });
}
test("stale artifacts report expected and actual versions", () => {
  for (const field of ["bindingVersion", "interfaceVersion", "storageLayoutVersion", "deploymentSchemaVersion"]) {
    const { plan, actual, options } = fixture("migration");
    actual[field] = field === "bindingVersion" ? "2.0.0" : 99;
    assert.ok(checkReleaseVersions(plan, actual, options).some((e) => e.startsWith(`${field}: expected`)));
  }
});
test("patch cannot prematurely advance interface or hide additive ABI changes", () => {
  const { plan, actual, options } = fixture("patch");
  plan.expected.interfaceVersion = actual.interfaceVersion = 3;
  options.abi.additive.push("new method");
  const errors = checkReleaseVersions(plan, actual, options);
  assert.ok(errors.some((e) => e.includes("premature")));
  assert.ok(errors.some((e) => e.includes("additive ABI")));
});
test("migration requires matching evidence and lock/generator synchronization", () => {
  const { plan, actual, options } = fixture("migration");
  options.migration = null; actual.lockCrates["upto-session"] = "0.2.0";
  actual.bindingLockVersion = "2.0.0"; actual.generatorBindingVersion = "2.0.0";
  const errors = checkReleaseVersions(plan, actual, options);
  for (const phrase of ["migration evidence", "Cargo.lock", "package-lock", "generator"]) assert.ok(errors.some((e) => e.includes(phrase)));
});
test("tagging needs exact version and finalized changelog section", () => {
  const { plan, actual, options } = fixture("patch");
  assert.ok(checkReleaseVersions(plan, actual, { ...options, tag: "v0.2.1" }).some((e) => e.includes("finalized")));
  assert.deepEqual(checkReleaseVersions(plan, actual, { ...options, tag: "v0.2.1", changelog: "## v0.2.1\n" }), []);
  assert.ok(checkReleaseVersions(plan, actual, { ...options, tag: "v0.2.9", changelog: "## v0.2.9\n" }).length);
});
