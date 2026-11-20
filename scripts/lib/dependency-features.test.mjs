import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateFeatureGraphs,
  formatViolations,
  mergeFeatureGraphs,
  parseCargoTreeDepth,
  validateFeatureAllowlist,
} from "./dependency-features.mjs";

const SAMPLE_RELEASE_TREE = `
0upto-session v0.3.0 (/repo/contracts/upto-session) []
1soroban-sdk v28.0.0 []
2soroban-env-guest v28.0.2 []
3soroban-env-common v28.0.2 []
4stellar-xdr v28.0.0 []
2stellar-strkey v0.0.16 [default]
`;

const SAMPLE_TEST_TREE = `
0upto-session v0.3.0 (/repo/contracts/upto-session) []
1soroban-sdk v28.0.0 [testutils]
2soroban-env-host v28.0.2 [recording_mode,testutils]
1test-token v0.1.0 (/repo/contracts/test-token) [testutils]
`;

function baseAllowlist(overrides = {}) {
  return {
    schemaVersion: 1,
    releaseTarget: "wasm32v1-none",
    releasePackages: ["upto-session"],
    testPackages: ["upto-session"],
    releaseAllowlist: {
      "stellar-strkey": ["default"],
    },
    exceptions: [],
    ...overrides,
  };
}

test("parseCargoTreeDepth extracts features and full dependency paths", () => {
  const graph = parseCargoTreeDepth(SAMPLE_RELEASE_TREE);
  assert.equal(graph.packageCount, 6);
  assert.equal(graph.featureCount, 1);

  const strkey = graph.packages.find((pkg) => pkg.name === "stellar-strkey");
  assert.ok(strkey);
  assert.deepEqual(strkey.features, ["default"]);
  assert.deepEqual(strkey.featurePaths.default, [
    "upto-session 0.3.0 -> soroban-sdk 28.0.0 -> stellar-strkey 0.0.16",
  ]);
});

test("evaluateFeatureGraphs reports release and test feature graphs separately", () => {
  const releaseGraph = parseCargoTreeDepth(SAMPLE_RELEASE_TREE);
  const testGraph = parseCargoTreeDepth(SAMPLE_TEST_TREE);
  const evaluation = evaluateFeatureGraphs({
    releaseGraph,
    testGraph,
    allowlist: baseAllowlist(),
    nowDate: new Date("2026-11-20T00:00:00Z"),
  });

  assert.equal(evaluation.passed, true);
  assert.deepEqual(evaluation.releaseSummary.enabledFeatures, {
    "stellar-strkey": ["default"],
  });
  assert.deepEqual(evaluation.testSummary.testOnlyFeatures, {
    "soroban-env-host": ["recording_mode", "testutils"],
    "soroban-sdk": ["testutils"],
    "test-token": ["testutils"],
  });
});

test("new enabled release feature fails with dependency path context", () => {
  const expandedReleaseTree = `
0upto-session v0.3.0 (/repo/contracts/upto-session) []
1soroban-sdk v28.0.0 [alloc]
2stellar-strkey v0.0.16 [default]
`;
  const evaluation = evaluateFeatureGraphs({
    releaseGraph: parseCargoTreeDepth(expandedReleaseTree),
    testGraph: parseCargoTreeDepth(SAMPLE_TEST_TREE),
    allowlist: baseAllowlist(),
    nowDate: new Date("2026-11-20T00:00:00Z"),
  });

  assert.equal(evaluation.passed, false);
  assert.equal(evaluation.violations.length, 1);
  assert.equal(evaluation.violations[0].package, "soroban-sdk");
  assert.equal(evaluation.violations[0].feature, "alloc");
  assert.deepEqual(evaluation.violations[0].paths, [
    "upto-session 0.3.0 -> soroban-sdk 28.0.0",
  ]);

  const formatted = formatViolations(evaluation.violations);
  assert.match(formatted, /soroban-sdk/);
  assert.match(formatted, /"alloc"/);
  assert.match(formatted, /upto-session 0\.3\.0 -> soroban-sdk 28\.0\.0/);
});

test("reviewed exception with owner, reason, and future expiry permits release feature", () => {
  const expandedReleaseTree = `
0upto-session v0.3.0 (/repo/contracts/upto-session) []
1soroban-sdk v28.0.0 [alloc]
2stellar-strkey v0.0.16 [default]
`;
  const allowlist = baseAllowlist({
    exceptions: [
      {
        package: "soroban-sdk",
        feature: "alloc",
        scope: "release",
        owner: "contracts-maintainers",
        reason: "Temporary review exception during SDK evaluation.",
        expiresOn: "2027-06-30",
      },
    ],
  });

  const evaluation = evaluateFeatureGraphs({
    releaseGraph: parseCargoTreeDepth(expandedReleaseTree),
    testGraph: parseCargoTreeDepth(SAMPLE_TEST_TREE),
    allowlist,
    nowDate: new Date("2026-11-20T00:00:00Z"),
  });

  assert.equal(evaluation.passed, true);
  assert.equal(evaluation.appliedExceptions.length, 1);
  assert.equal(evaluation.appliedExceptions[0].owner, "contracts-maintainers");
});

test("expired or incomplete exceptions fail validation", () => {
  assert.throws(
    () =>
      validateFeatureAllowlist(
        baseAllowlist({
          exceptions: [
            {
              package: "soroban-sdk",
              feature: "alloc",
              scope: "release",
              owner: "contracts-maintainers",
              reason: "Expired exception.",
              expiresOn: "2026-10-01",
            },
          ],
        }),
        new Date("2026-11-20T00:00:00Z"),
      ),
    /expired on 2026-10-01/,
  );

  assert.throws(
    () =>
      validateFeatureAllowlist(
        baseAllowlist({
          exceptions: [
            {
              package: "soroban-sdk",
              feature: "alloc",
              scope: "release",
              owner: "",
              reason: "Missing owner.",
              expiresOn: "2027-06-30",
            },
          ],
        }),
        new Date("2026-11-20T00:00:00Z"),
      ),
    /missing required field: owner/,
  );
});

test("mergeFeatureGraphs unions paths across multiple workspace packages", () => {
  const first = parseCargoTreeDepth(SAMPLE_RELEASE_TREE);
  const second = parseCargoTreeDepth(`
0test-token v0.1.0 (/repo/contracts/test-token) []
1soroban-sdk v28.0.0 []
2stellar-strkey v0.0.16 [default]
`);
  const merged = mergeFeatureGraphs([first, second]);
  const strkey = merged.packages.find((pkg) => pkg.name === "stellar-strkey");
  assert.equal(strkey.featurePaths.default.length, 2);
});
