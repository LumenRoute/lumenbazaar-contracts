import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BUDGET_FIELDS,
  LIFECYCLE_OPERATIONS,
  budgetCeiling,
  buildThresholds,
  evaluateBudgets,
} from "./resource-budgets.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function reportRow(operation, overrides = {}) {
  const row = { operation };
  for (const field of BUDGET_FIELDS) {
    row[field] = 100;
  }
  return { ...row, ...overrides };
}

function fullReport(overrides = {}) {
  return { rows: LIFECYCLE_OPERATIONS.map((operation) => reportRow(operation, overrides)) };
}

function thresholdsFor(rows) {
  return buildThresholds({ rows });
}

test("budgetCeiling applies headroom and never drops below the floor", () => {
  assert.equal(budgetCeiling(100, 25, 0), 125);
  assert.equal(budgetCeiling(0, 25, 512), 512);
  assert.equal(budgetCeiling(101, 0, 0), 101);
});

test("buildThresholds derives a ceiling per operation and field", () => {
  const thresholds = thresholdsFor([
    reportRow("create_session"),
    reportRow("settle"),
    reportRow("cancel"),
    reportRow("recover_expired"),
    reportRow("extend_ttl"),
  ]);
  for (const operation of LIFECYCLE_OPERATIONS) {
    for (const field of BUDGET_FIELDS) {
      assert.equal(typeof thresholds.operations[operation][field], "number");
    }
  }
});

test("evaluateBudgets accepts a report within every reviewed ceiling", () => {
  const report = fullReport();
  const thresholds = thresholdsFor(report.rows);
  const { failures, rows } = evaluateBudgets({ report, thresholds });
  assert.deepEqual(failures, []);
  assert.equal(rows.length, LIFECYCLE_OPERATIONS.length);
  assert.equal(rows[0].storageLedgerBytes, 200);
  assert.equal(rows[0].storageRentBumps, 200);
});

test("evaluateBudgets fails closed on a storage or rent regression", () => {
  const thresholds = thresholdsFor(fullReport().rows);
  const report = fullReport({ temporary_rent_ledger_bytes: 5000 });
  const { failures } = evaluateBudgets({ report, thresholds });
  assert.ok(
    failures.some(
      (failure) =>
        failure.includes("temporary_rent_ledger_bytes") && failure.includes("regressed"),
    ),
  );
});

test("evaluateBudgets fails closed when a lifecycle method is missing", () => {
  const thresholds = thresholdsFor(fullReport().rows);
  const report = { rows: [reportRow("settle")] };
  const { failures } = evaluateBudgets({ report, thresholds });
  assert.ok(failures.some((failure) => failure.includes("create_session")));
});

test("evaluateBudgets fails closed when a zero-baseline field becomes non-zero", () => {
  const baseline = LIFECYCLE_OPERATIONS.map((operation) =>
    reportRow(operation, { contract_events_size_bytes: 0 }),
  );
  const thresholds = thresholdsFor(baseline);
  const report = {
    rows: LIFECYCLE_OPERATIONS.map((operation) =>
      reportRow(operation, {
        contract_events_size_bytes: operation === "extend_ttl" ? 120 : 0,
      }),
    ),
  };
  const { failures } = evaluateBudgets({ report, thresholds });
  assert.ok(failures.some((failure) => failure.includes("extend_ttl.contract_events_size_bytes")));
});

test("committed report satisfies the committed reviewed thresholds", () => {
  const report = JSON.parse(
    readFileSync(join(repoRoot, "artifacts", "resource-usage", "upto-session.json"), "utf8"),
  );
  const thresholds = JSON.parse(
    readFileSync(join(repoRoot, "artifacts", "resource-usage", "thresholds.json"), "utf8"),
  );
  const { failures } = evaluateBudgets({ report, thresholds });
  assert.deepEqual(failures, []);
});
