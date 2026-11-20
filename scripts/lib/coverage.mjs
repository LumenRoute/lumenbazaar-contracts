import { relative } from "node:path";

export const COVERAGE_SCHEMA_VERSION = 1;

const TEST_TOKEN_FIXTURE_FILES = new Set([
  "contracts/test-token/src/adversarial.rs",
  "contracts/test-token/src/asset_probe.rs",
  "contracts/test-token/src/conformance.rs",
  "contracts/test-token/src/decimal_matrix.rs",
  "contracts/test-token/src/reentry.rs",
]);

export function normalizeRepoPath(filePath, repoRoot = null) {
  let normalized = String(filePath).replaceAll("\\", "/");
  if (repoRoot) {
    const normalizedRoot = String(repoRoot).replaceAll("\\", "/").replace(/\/+$/, "");
    if (normalized.toLowerCase().startsWith(`${normalizedRoot.toLowerCase()}/`)) {
      normalized = normalized.slice(normalizedRoot.length + 1);
    } else if (/^[a-zA-Z]:\//.test(normalized) || normalized.startsWith("/")) {
      const rel = relative(repoRoot, filePath).replaceAll("\\", "/");
      if (!rel.startsWith("..")) {
        normalized = rel;
      }
    }
  }
  return normalized.replace(/^\.\//, "");
}

export function classifyProductionFile(filePath, repoRoot = null) {
  const path = normalizeRepoPath(filePath, repoRoot);

  if (!path.endsWith(".rs")) {
    return null;
  }
  if (
    path.startsWith("bindings/") ||
    path.startsWith("fuzz/") ||
    path.startsWith("target/") ||
    path.startsWith("scripts/") ||
    path.startsWith("tests/") ||
    path.includes("/tests/") ||
    path.endsWith("/test.rs") ||
    path.endsWith("_test.rs") ||
    TEST_TOKEN_FIXTURE_FILES.has(path)
  ) {
    return null;
  }

  const contractMatch = path.match(/^contracts\/([^/]+)\/src\/.+\.rs$/);
  if (contractMatch) {
    return {
      contract: contractMatch[1],
      modulePath: path,
    };
  }

  const formalMatch = path.match(/^formal\/([^/]+)\/src\/.+\.rs$/);
  if (formalMatch) {
    return {
      contract: formalMatch[1],
      modulePath: path,
    };
  }

  return null;
}

export function percent(covered, count) {
  if (count <= 0) {
    return 100;
  }
  return Number(((covered / count) * 100).toFixed(2));
}

export function summarizeLlvmCovExport(llvmExport, repoRoot = null) {
  const entries = llvmExport?.data?.[0]?.files;
  if (!Array.isArray(entries)) {
    throw new Error("Invalid llvm-cov export JSON: expected data[0].files array.");
  }

  const hasTrueBranches = entries.some((file) => (file?.summary?.branches?.count ?? 0) > 0);
  const branchMetric = hasTrueBranches ? "llvm-branches" : "llvm-regions";

  const moduleMap = new Map();
  const contractMap = new Map();

  for (const file of entries) {
    const classified = classifyProductionFile(file.filename, repoRoot);
    if (!classified) {
      continue;
    }

    const linesSummary = file.summary?.lines ?? { covered: 0, count: 0 };
    const regionsSummary = file.summary?.regions ?? { covered: 0, count: 0 };
    const branchesRaw = hasTrueBranches
      ? (file.summary?.branches ?? { covered: 0, count: 0 })
      : regionsSummary;
    const functionsSummary = file.summary?.functions ?? { covered: 0, count: 0 };

    const moduleRecord = {
      contract: classified.contract,
      path: classified.modulePath,
      lines: {
        covered: linesSummary.covered ?? 0,
        count: linesSummary.count ?? 0,
        percent: percent(linesSummary.covered ?? 0, linesSummary.count ?? 0),
      },
      branches: {
        covered: branchesRaw.covered ?? 0,
        count: branchesRaw.count ?? 0,
        percent: percent(branchesRaw.covered ?? 0, branchesRaw.count ?? 0),
      },
      functions: {
        covered: functionsSummary.covered ?? 0,
        count: functionsSummary.count ?? 0,
        percent: percent(functionsSummary.covered ?? 0, functionsSummary.count ?? 0),
      },
    };
    moduleMap.set(classified.modulePath, moduleRecord);

    let contractAgg = contractMap.get(classified.contract);
    if (!contractAgg) {
      contractAgg = {
        contract: classified.contract,
        moduleCount: 0,
        linesCovered: 0,
        linesCount: 0,
        branchesCovered: 0,
        branchesCount: 0,
        functionsCovered: 0,
        functionsCount: 0,
      };
      contractMap.set(classified.contract, contractAgg);
    }
    contractAgg.moduleCount += 1;
    contractAgg.linesCovered += moduleRecord.lines.covered;
    contractAgg.linesCount += moduleRecord.lines.count;
    contractAgg.branchesCovered += moduleRecord.branches.covered;
    contractAgg.branchesCount += moduleRecord.branches.count;
    contractAgg.functionsCovered += moduleRecord.functions.covered;
    contractAgg.functionsCount += moduleRecord.functions.count;
  }

  const modules = [...moduleMap.values()].sort((left, right) =>
    left.path.localeCompare(right.path),
  );

  const contracts = [...contractMap.values()]
    .sort((left, right) => left.contract.localeCompare(right.contract))
    .map((agg) => ({
      contract: agg.contract,
      moduleCount: agg.moduleCount,
      lines: {
        covered: agg.linesCovered,
        count: agg.linesCount,
        percent: percent(agg.linesCovered, agg.linesCount),
      },
      branches: {
        covered: agg.branchesCovered,
        count: agg.branchesCount,
        percent: percent(agg.branchesCovered, agg.branchesCount),
      },
      functions: {
        covered: agg.functionsCovered,
        count: agg.functionsCount,
        percent: percent(agg.functionsCovered, agg.functionsCount),
      },
    }));

  const totals = contracts.reduce(
    (acc, item) => ({
      linesCovered: acc.linesCovered + item.lines.covered,
      linesCount: acc.linesCount + item.lines.count,
      branchesCovered: acc.branchesCovered + item.branches.covered,
      branchesCount: acc.branchesCount + item.branches.count,
      functionsCovered: acc.functionsCovered + item.functions.covered,
      functionsCount: acc.functionsCount + item.functions.count,
    }),
    {
      linesCovered: 0,
      linesCount: 0,
      branchesCovered: 0,
      branchesCount: 0,
      functionsCovered: 0,
      functionsCount: 0,
    },
  );

  return {
    branchMetric,
    totals: {
      lines: {
        covered: totals.linesCovered,
        count: totals.linesCount,
        percent: percent(totals.linesCovered, totals.linesCount),
      },
      branches: {
        covered: totals.branchesCovered,
        count: totals.branchesCount,
        percent: percent(totals.branchesCovered, totals.branchesCount),
      },
      functions: {
        covered: totals.functionsCovered,
        count: totals.functionsCount,
        percent: percent(totals.functionsCovered, totals.functionsCount),
      },
    },
    contracts,
    modules,
  };
}

export function validateCoverageThresholds(thresholds) {
  if (!thresholds || typeof thresholds !== "object" || thresholds.schemaVersion !== COVERAGE_SCHEMA_VERSION) {
    throw new Error(`Coverage thresholds must use schemaVersion ${COVERAGE_SCHEMA_VERSION}.`);
  }
  if (!thresholds.contracts || typeof thresholds.contracts !== "object") {
    throw new Error("Coverage thresholds must define a contracts map.");
  }
  if (!thresholds.criticalModules || typeof thresholds.criticalModules !== "object") {
    throw new Error("Coverage thresholds must define a criticalModules map.");
  }
  for (const [name, rule] of Object.entries(thresholds.contracts)) {
    validateRule(`contract "${name}"`, rule);
  }
  for (const [modulePath, rule] of Object.entries(thresholds.criticalModules)) {
    validateRule(`critical module "${modulePath}"`, rule);
    if (typeof rule.rationale !== "string" || rule.rationale.trim() === "") {
      throw new Error(`Critical module "${modulePath}" threshold must include a rationale.`);
    }
  }
}

function validateRule(label, rule) {
  if (
    typeof rule?.minLinePercent !== "number" ||
    rule.minLinePercent < 0 ||
    rule.minLinePercent > 100 ||
    typeof rule?.minBranchPercent !== "number" ||
    rule.minBranchPercent < 0 ||
    rule.minBranchPercent > 100
  ) {
    throw new Error(`Invalid coverage threshold for ${label}.`);
  }
}

export function evaluateCoverageThresholds(summary, thresholds) {
  validateCoverageThresholds(thresholds);

  const contractByName = new Map(summary.contracts.map((item) => [item.contract, item]));
  const moduleByPath = new Map(summary.modules.map((item) => [item.path, item]));
  const failures = [];
  const contractResults = [];
  const moduleResults = [];

  for (const [name, rule] of Object.entries(thresholds.contracts).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const observed = contractByName.get(name);
    if (!observed) {
      failures.push(`Missing coverage data for contract "${name}".`);
      contractResults.push({
        contract: name,
        minLinePercent: rule.minLinePercent,
        minBranchPercent: rule.minBranchPercent,
        observedLinePercent: null,
        observedBranchPercent: null,
        passed: false,
      });
      continue;
    }
    const lineOk = observed.lines.percent >= rule.minLinePercent;
    const branchOk = observed.branches.percent >= rule.minBranchPercent;
    if (!lineOk) {
      failures.push(
        `Contract "${name}" line coverage ${observed.lines.percent}% is below minimum ${rule.minLinePercent}%.`,
      );
    }
    if (!branchOk) {
      failures.push(
        `Contract "${name}" branch coverage (${summary.branchMetric}) ${observed.branches.percent}% is below minimum ${rule.minBranchPercent}%.`,
      );
    }
    contractResults.push({
      contract: name,
      minLinePercent: rule.minLinePercent,
      minBranchPercent: rule.minBranchPercent,
      observedLinePercent: observed.lines.percent,
      observedBranchPercent: observed.branches.percent,
      passed: lineOk && branchOk,
    });
  }

  for (const [modulePath, rule] of Object.entries(thresholds.criticalModules).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const observed = moduleByPath.get(modulePath);
    if (!observed) {
      failures.push(`Missing coverage data for critical module "${modulePath}".`);
      moduleResults.push({
        path: modulePath,
        rationale: rule.rationale,
        minLinePercent: rule.minLinePercent,
        minBranchPercent: rule.minBranchPercent,
        observedLinePercent: null,
        observedBranchPercent: null,
        passed: false,
      });
      continue;
    }
    const lineOk = observed.lines.percent >= rule.minLinePercent;
    const branchOk = observed.branches.percent >= rule.minBranchPercent;
    if (!lineOk) {
      failures.push(
        `Critical module "${modulePath}" line coverage ${observed.lines.percent}% is below minimum ${rule.minLinePercent}%.`,
      );
    }
    if (!branchOk) {
      failures.push(
        `Critical module "${modulePath}" branch coverage (${summary.branchMetric}) ${observed.branches.percent}% is below minimum ${rule.minBranchPercent}%.`,
      );
    }
    moduleResults.push({
      path: modulePath,
      rationale: rule.rationale,
      minLinePercent: rule.minLinePercent,
      minBranchPercent: rule.minBranchPercent,
      observedLinePercent: observed.lines.percent,
      observedBranchPercent: observed.branches.percent,
      passed: lineOk && branchOk,
    });
  }

  return {
    passed: failures.length === 0,
    failures,
    contractResults,
    moduleResults,
  };
}
