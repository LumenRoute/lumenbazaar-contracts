// Rejects the LBT test-token under any pubnet, production, unknown or missing
// network label, and rejects text that presents LBT as USDC.
//
//   node scripts/check-test-token-guard.mjs
//       Scan committed deployment manifests, testnet evidence and docs.
//   node scripts/check-test-token-guard.mjs --manifest <path> [--manifest <path>]
//       Check only the named manifests.
//   node scripts/check-test-token-guard.mjs --release-label <label> --artifacts-dir <dir>
//   node scripts/check-test-token-guard.mjs --release-label <label> --artifact <name> [...]
//       Check a release: refuse to package test_token.wasm unless the label
//       is local, standalone or testnet.
//
// LBT stays available for local and testnet manifests, tests and tooling.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { checkDocument, checkManifest, checkRelease } from "./lib/test-token-guard.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);

const manifests = valuesOf("--manifest");
const releaseLabel = valuesOf("--release-label");
const artifactsDirs = valuesOf("--artifacts-dir");
const artifacts = valuesOf("--artifact");
const violations = [];
let checked = 0;

if (releaseLabel.length > 1) {
  fail(["--release-label may be given once"]);
}

if (releaseLabel.length === 1 || artifactsDirs.length > 0 || artifacts.length > 0) {
  const names = [...artifacts];
  for (const dir of artifactsDirs) {
    if (!existsSync(dir) || !statSync(dir).isDirectory()) {
      fail([`--artifacts-dir ${dir} is not a directory`]);
    }
    names.push(...readdirSync(dir).filter((name) => statSync(join(dir, name)).isFile()));
  }
  violations.push(...checkRelease({ label: releaseLabel[0], artifacts: names.sort() }, "release"));
  checked += 1;
}

if (manifests.length > 0) {
  for (const path of manifests) {
    checkManifestFile(path);
  }
} else if (checked === 0) {
  for (const path of [
    ...jsonFiles(join(repoRoot, "deployments"), ["receipts"]),
    ...jsonFiles(join(repoRoot, "artifacts", "testnet"), []),
  ]) {
    checkManifestFile(path);
  }
  for (const path of [
    "README.md",
    "contracts/test-token/README.md",
    "deployments/README.md",
    "bindings/upto-session/README.md",
    ...markdownFiles(join(repoRoot, "docs")).map((file) => relative(repoRoot, file)),
  ]) {
    const absolute = join(repoRoot, path);
    if (existsSync(absolute)) {
      violations.push(...checkDocument(readFileSync(absolute, "utf8"), path.replaceAll("\\", "/")));
      checked += 1;
    }
  }
}

if (violations.length > 0) {
  fail(violations);
}
console.log(`test-token guard passed (${checked} input(s) checked; LBT allowed only under local/standalone/testnet labels).`);

function checkManifestFile(path) {
  const label = relative(repoRoot, path).replaceAll("\\", "/") || path;
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    violations.push(`${label}: cannot be read as JSON (${error.message}); refusing to assume it is safe`);
    return;
  }
  violations.push(...checkManifest(parsed, label));
  checked += 1;
}

function jsonFiles(dir, skip) {
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return skip.includes(entry.name) ? [] : jsonFiles(path, skip);
    }
    return entry.name.endsWith(".json") ? [path] : [];
  });
}

function markdownFiles(dir) {
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? markdownFiles(path) : entry.name.endsWith(".md") ? [path] : [];
  });
}

function valuesOf(flag) {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === flag) {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) {
        fail([`${flag} requires a value`]);
      }
      values.push(value);
      index += 1;
    }
  }
  return values;
}

function fail(messages) {
  for (const message of messages) {
    console.error(`test-token guard: ${message}`);
  }
  process.exit(1);
}
