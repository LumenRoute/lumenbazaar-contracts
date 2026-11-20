import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyProductionFile,
  evaluateCoverageThresholds,
  summarizeLlvmCovExport,
  validateCoverageThresholds,
} from "./coverage.mjs";

test("classifyProductionFile excludes tests, fixtures, bindings, and fuzz harnesses", () => {
  assert.deepEqual(classifyProductionFile("/repo/contracts/upto-session/src/lib.rs", "/repo"), {
    contract: "upto-session",
    modulePath: "contracts/upto-session/src/lib.rs",
  });
  assert.deepEqual(classifyProductionFile("formal/escrow-model/src/lib.rs"), {
    contract: "escrow-model",
    modulePath: "formal/escrow-model/src/lib.rs",
  });

  assert.equal(classifyProductionFile("contracts/upto-session/src/test.rs"), null);
  assert.equal(classifyProductionFile("contracts/upto-session/src/auth_test.rs"), null);
  assert.equal(classifyProductionFile("contracts/upto-session/tests/session_indexes.rs"), null);
  assert.equal(classifyProductionFile("contracts/test-token/src/adversarial.rs"), null);
  assert.equal(classifyProductionFile("bindings/upto-session/src/index.ts"), null);
  assert.equal(classifyProductionFile("fuzz/src/session.rs"), null);
});

test("summarizeLlvmCovExport aggregates production contracts and falls back to llvm-regions on stable", () => {
  const sampleExport = {
    data: [
      {
        files: [
          {
            filename: "/repo/contracts/upto-session/src/lib.rs",
            summary: {
              lines: { covered: 90, count: 100 },
              regions: { covered: 85, count: 100 },
              branches: { covered: 0, count: 0 },
              functions: { covered: 18, count: 20 },
            },
          },
          {
            filename: "/repo/contracts/upto-session/src/validation.rs",
            summary: {
              lines: { covered: 48, count: 50 },
              regions: { covered: 45, count: 50 },
              branches: { covered: 0, count: 0 },
              functions: { covered: 10, count: 10 },
            },
          },
          {
            filename: "/repo/contracts/upto-session/src/test.rs",
            summary: {
              lines: { covered: 10, count: 1000 },
              regions: { covered: 10, count: 1000 },
              branches: { covered: 0, count: 0 },
              functions: { covered: 1, count: 100 },
            },
          },
        ],
      },
    ],
  };

  const summary = summarizeLlvmCovExport(sampleExport, "/repo");
  assert.equal(summary.branchMetric, "llvm-regions");
  assert.equal(summary.contracts.length, 1);
  assert.equal(summary.contracts[0].contract, "upto-session");
  assert.equal(summary.contracts[0].lines.percent, 92);
  assert.equal(summary.contracts[0].branches.percent, 86.67);
  assert.equal(summary.modules.length, 2);
});

test("evaluateCoverageThresholds enforces per-contract and critical module minimums", () => {
  const summary = {
    branchMetric: "llvm-regions",
    contracts: [
      {
        contract: "upto-session",
        lines: { covered: 85, count: 100, percent: 85 },
        branches: { covered: 80, count: 100, percent: 80 },
      },
    ],
    modules: [
      {
        contract: "upto-session",
        path: "contracts/upto-session/src/validation.rs",
        lines: { covered: 75, count: 100, percent: 75 },
        branches: { covered: 70, count: 100, percent: 70 },
      },
    ],
  };

  const passing = evaluateCoverageThresholds(summary, {
    schemaVersion: 1,
    contracts: {
      "upto-session": { minLinePercent: 80, minBranchPercent: 75 },
    },
    criticalModules: {
      "contracts/upto-session/src/validation.rs": {
        minLinePercent: 70,
        minBranchPercent: 65,
        rationale: "Guards authorization, cap, and arithmetic bounds.",
      },
    },
  });
  assert.equal(passing.passed, true);

  const failing = evaluateCoverageThresholds(summary, {
    schemaVersion: 1,
    contracts: {
      "upto-session": { minLinePercent: 90, minBranchPercent: 75 },
    },
    criticalModules: {
      "contracts/upto-session/src/validation.rs": {
        minLinePercent: 80,
        minBranchPercent: 75,
        rationale: "Guards authorization, cap, and arithmetic bounds.",
      },
    },
  });
  assert.equal(failing.passed, false);
  assert.equal(failing.failures.length, 3);
});

test("validateCoverageThresholds rejects missing rationale on critical modules", () => {
  assert.throws(
    () =>
      validateCoverageThresholds({
        schemaVersion: 1,
        contracts: {},
        criticalModules: {
          "contracts/upto-session/src/lib.rs": {
            minLinePercent: 80,
            minBranchPercent: 70,
            rationale: "",
          },
        },
      }),
    /must include a rationale/,
  );
});
