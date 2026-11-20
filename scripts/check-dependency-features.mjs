import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  evaluateFeatureGraphs,
  formatViolations,
  mergeFeatureGraphs,
  parseCargoTreeDepth,
  validateFeatureAllowlist,
} from "./lib/dependency-features.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const allowlistPath = join(repoRoot, "audits", "dependency-feature-allowlist.json");
const reportPath = optionValue("--report");

const allowlist = JSON.parse(readFileSync(allowlistPath, "utf8"));
validateFeatureAllowlist(allowlist);

const releaseGraphs = allowlist.releasePackages.map((pkg) =>
  parseCargoTreeDepth(
    runCargoTree([
      "tree",
      "--locked",
      "--prefix",
      "depth",
      "--edges",
      "normal",
      "--target",
      allowlist.releaseTarget,
      "--format",
      "{p} [{f}]",
      "-p",
      pkg,
    ]),
  ),
);
const releaseGraph = mergeFeatureGraphs(releaseGraphs);

const testGraphs = allowlist.testPackages.map((pkg) =>
  parseCargoTreeDepth(
    runCargoTree([
      "tree",
      "--locked",
      "--prefix",
      "depth",
      "--edges",
      "normal,dev",
      "--format",
      "{p} [{f}]",
      "-p",
      pkg,
    ]),
  ),
);
const testGraph = mergeFeatureGraphs(testGraphs);

const evaluation = evaluateFeatureGraphs({
  releaseGraph,
  testGraph,
  allowlist,
});

console.log(
  `Release feature graph (${allowlist.releaseTarget}, packages: ${allowlist.releasePackages.join(", ")}): ` +
    `${evaluation.releaseSummary.packageCount} package(s), ${evaluation.releaseSummary.featureCount} enabled feature(s).`,
);
console.log(
  `Test feature graph (host, packages: ${allowlist.testPackages.join(", ")}): ` +
    `${evaluation.testSummary.packageCount} package(s), ${evaluation.testSummary.featureCount} enabled feature(s), ` +
    `${Object.keys(evaluation.testSummary.testOnlyFeatures).length} package(s) with test-only features.`,
);

if (evaluation.appliedExceptions.length > 0) {
  console.log(`Applied ${evaluation.appliedExceptions.length} reviewed release feature exception(s):`);
  for (const item of evaluation.appliedExceptions) {
    console.log(
      `  - ${item.package}/${item.feature} (owner: ${item.owner}, expires: ${item.expiresOn})`,
    );
  }
}

const report = {
  schemaVersion: 1,
  allowlist: relative(repoRoot, allowlistPath).replaceAll("\\", "/"),
  releaseTarget: allowlist.releaseTarget,
  releasePackages: allowlist.releasePackages,
  testPackages: allowlist.testPackages,
  passed: evaluation.passed,
  release: {
    packageCount: releaseGraph.packageCount,
    featureCount: releaseGraph.featureCount,
    enabledFeatures: evaluation.releaseSummary.enabledFeatures,
    packages: releaseGraph.packages,
  },
  test: {
    packageCount: testGraph.packageCount,
    featureCount: testGraph.featureCount,
    testOnlyFeatures: evaluation.testSummary.testOnlyFeatures,
    packages: testGraph.packages,
  },
  appliedExceptions: evaluation.appliedExceptions,
  violations: evaluation.violations,
};

if (reportPath) {
  const output = isAbsolute(reportPath) ? reportPath : resolve(repoRoot, reportPath);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`Dependency feature report written to ${output}`);
}

if (!evaluation.passed) {
  throw new Error(
    `Found ${evaluation.violations.length} unreviewed release dependency feature(s):\n` +
      `${formatViolations(evaluation.violations)}\n` +
      `Update audits/dependency-feature-allowlist.json with a reviewed allowlist entry or time-bounded exception.`,
  );
}

console.log("Dependency feature allowlist check passed.");

function runCargoTree(args) {
  return execFileSync("cargo", args, {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function optionValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
}
