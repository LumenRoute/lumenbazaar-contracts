import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "./lib/stellar-cli.mjs";
import { classifyAbi, extractAbi } from "./lib/abi-compatibility.mjs";
import { checkReleaseVersions } from "./lib/release-versions.mjs";

const text = (path) => readFileSync(join(repoRoot, path), "utf8");
const json = (path) => JSON.parse(text(path));
const rust = (path, name) => {
  const value = text(path).match(new RegExp(`pub const ${name}: u32 = (\\d+);`))?.[1];
  if (!value) throw new Error(`Cannot read ${name} in ${path}`);
  return Number(value);
};
const plan = json("artifacts/interface/release-plan.json");
const crates = Object.fromEntries(["upto-session", "test-token", "policy-wallet-example"].map((name) => {
  const version = text(`contracts/${name}/Cargo.toml`).match(/^version = "([^"]+)"/m)?.[1];
  if (!version) throw new Error(`Missing crate version: ${name}`);
  return [name, version];
}));
const lock = text("Cargo.lock");
const actual = {
  crates,
  lockCrates: Object.fromEntries(Object.keys(crates).map((name) => [name, lock.match(new RegExp(`name = "${name}"\\r?\\nversion = "([^"]+)"`))?.[1]])),
  interfaceVersion: rust("contracts/upto-session/src/lib.rs", "INTERFACE_VERSION"),
  storageLayoutVersion: rust("contracts/upto-session/src/storage.rs", "STORAGE_LAYOUT_VERSION"),
  bindingVersion: json("bindings/upto-session/package.json").version,
  bindingLockVersion: json("bindings/upto-session/package-lock.json").packages[""].version,
  bindingLockTopVersion: json("bindings/upto-session/package-lock.json").version,
  generatorBindingVersion: text("scripts/generate-bindings.mjs").match(/packageJson.version = "([^"]+)"/)?.[1],
  deploymentSchemaVersion: Number(text("scripts/lib/public-manifest.mjs").match(/const document = \{\s*schemaVersion: (\d+)/)?.[1]),
};
const abi = classifyAbi(json("artifacts/interface/upto-session-release-baseline.json"),
  extractAbi(json("artifacts/spec/upto-session.json"), actual.interfaceVersion, actual.storageLayoutVersion));
const tagIndex = process.argv.indexOf("--tag");
if (tagIndex >= 0 && !process.argv[tagIndex + 1]) throw new Error("--tag requires a tag name");
const errors = checkReleaseVersions(plan, actual, { abi,
  migration: plan.migration ? json(plan.migration) : null, changelog: text("CHANGELOG.md"),
  tag: tagIndex >= 0 ? process.argv[tagIndex + 1] : undefined });
if (errors.length) throw new Error(`Release version consistency failed:\n- ${errors.join("\n- ")}`);
console.log(`Release ${plan.releaseVersion}: ${plan.kind} mappings are consistent.`);
