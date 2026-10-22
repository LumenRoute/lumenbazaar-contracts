import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  COMPUTE_FIELDS,
  STORAGE_FIELDS,
  evaluateBudgets,
} from "./lib/resource-budgets.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const reportPath = join(repoRoot, "artifacts", "resource-usage", "upto-session.json");
const thresholdsPath = join(repoRoot, "artifacts", "resource-usage", "thresholds.json");

for (const [label, path] of [
  ["resource report", reportPath],
  ["thresholds", thresholdsPath],
]) {
  if (!existsSync(path)) {
    throw new Error(
      `Missing ${label} at ${relative(repoRoot, path)}; run scripts/report-resource-usage.mjs first.`,
    );
  }
}

const report = JSON.parse(readFileSync(reportPath, "utf8"));
const thresholds = JSON.parse(readFileSync(thresholdsPath, "utf8"));
const { failures, rows } = evaluateBudgets({ report, thresholds });

console.log("compute fields: " + COMPUTE_FIELDS.join(", "));
console.log("storage fields: " + STORAGE_FIELDS.join(", "));
for (const row of rows) {
  console.log(
    `${row.operation}: storage_rent_ledger_bytes=${row.storageLedgerBytes} storage_rent_bumps=${row.storageRentBumps}`,
  );
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`resource budget check failed: ${failure}`);
  }
  process.exitCode = 1;
} else {
  console.log(
    `resource and rent budgets verified for ${rows.length} lifecycle method(s)`,
  );
}
