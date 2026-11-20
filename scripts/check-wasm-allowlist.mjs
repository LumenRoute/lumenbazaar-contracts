import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  compareWasmSurface,
  formatWasmDiff,
  inspectWasmBytes,
  validateWasmAllowlist,
} from "./lib/wasm-allowlist.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const budgetPath = join(repoRoot, "artifacts", "resource-usage", "wasm-size-budget.json");
const allowlistDir = join(repoRoot, "artifacts", "audit-readiness");
const reportPath = optionValue("--report");

const ALLOWLIST_FILES = {
  "upto-session": "wasm-allowlist-upto-session.json",
  "policy-wallet-example": "wasm-allowlist-policy-wallet-example.json",
  "test-token": "wasm-allowlist-test-token.json",
};

const budget = JSON.parse(readFileSync(budgetPath, "utf8"));
if (!Array.isArray(budget.contracts) || budget.contracts.length === 0) {
  throw new Error("WASM size budget does not define release contracts.");
}

const results = [];
for (const entry of budget.contracts) {
  const allowlistFile = ALLOWLIST_FILES[entry.name];
  if (!allowlistFile) {
    throw new Error(`No WASM import/export allowlist registered for contract "${entry.name}".`);
  }
  const allowlistPath = join(allowlistDir, allowlistFile);
  if (!existsSync(allowlistPath)) {
    throw new Error(`Missing WASM allowlist file: ${relative(repoRoot, allowlistPath)}`);
  }

  const allowlist = JSON.parse(readFileSync(allowlistPath, "utf8"));
  validateWasmAllowlist(allowlist);

  if (allowlist.contract !== entry.name) {
    throw new Error(
      `WASM allowlist ${allowlistFile} targets "${allowlist.contract}" but expected "${entry.name}".`,
    );
  }
  if (allowlist.artifact !== entry.artifact) {
    throw new Error(
      `WASM allowlist ${allowlistFile} artifact "${allowlist.artifact}" does not match size-budget artifact "${entry.artifact}".`,
    );
  }

  const artifactPath = join(repoRoot, entry.artifact);
  if (!existsSync(artifactPath)) {
    throw new Error(
      `Missing optimized WASM artifact: ${entry.artifact}. Run "stellar contract build --locked" first.`,
    );
  }

  const observed = inspectWasmBytes(readFileSync(artifactPath));
  const comparison = compareWasmSurface(observed, allowlist);
  results.push({
    ...comparison,
    allowlistFile: relative(repoRoot, allowlistPath).replaceAll("\\", "/"),
  });
}

console.log("Contract | Classification | Imports | Exports | Size (bytes) | Result");
for (const row of results) {
  console.log(
    `${row.contract} | ${row.classification} | ${row.importCount} | ${row.exportCount} | ` +
      `${row.sizeBytes} | ${row.passed ? "PASS" : "FAIL"}`,
  );
  if (row.missingImports.length > 0 && row.passed) {
    console.log(
      `  note: ${row.missingImports.length} allowlisted import(s) were not emitted by this build.`,
    );
  }
}

const failures = results.filter((row) => !row.passed);
const report = {
  schemaVersion: 1,
  sourceBudget: relative(repoRoot, budgetPath).replaceAll("\\", "/"),
  passed: failures.length === 0,
  contracts: results,
};

if (reportPath) {
  const output = isAbsolute(reportPath) ? reportPath : resolve(repoRoot, reportPath);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`WASM import/export allowlist report written to ${output}`);
}

if (failures.length > 0) {
  const diffs = failures.map((failure) => formatWasmDiff(failure)).join("\n\n");
  throw new Error(
    `${failures.length} contract(s) failed the WASM import/export allowlist check:\n\n${diffs}\n\n` +
      "Review any new host imports or exported symbols before updating artifacts/audit-readiness/wasm-allowlist-*.json.",
  );
}

console.log("WASM import/export allowlist check passed.");

function optionValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
}
