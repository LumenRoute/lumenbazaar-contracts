import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  EXPECTED_DIFFERENCE_IDS,
  SHARED_OPERATIONS,
  buildCrossVersionTraceArtifact,
  createVersionRuntime,
  executeStep,
  loadAndVerifyCrossVersionTraces,
  repoRoot,
  runDifferentialTrace,
  verifyCrossVersionTraceArtifact,
} from "./cross-version-traces.mjs";

test("committed cross-version-behavior-traces.json matches deterministic builder and verifies against v2/v3 fixtures", () => {
  const generated = `${JSON.stringify(buildCrossVersionTraceArtifact(), null, 2)}\n`;
  const committed = readFileSync(
    join(repoRoot, "artifacts", "interface", "cross-version-behavior-traces.json"),
    "utf8",
  ).replace(/\r\n/g, "\n");
  assert.equal(committed, generated);

  const summary = loadAndVerifyCrossVersionTraces(repoRoot);
  assert.equal(summary.traceCount, 7);
  assert.deepEqual(summary.sharedOperations, [...SHARED_OPERATIONS]);
  assert.equal(summary.expectedDifferenceCount, EXPECTED_DIFFERENCE_IDS.length);
});

test("omitting any expected-difference fixture fails closed on intentional version divergence", () => {
  const artifact = buildCrossVersionTraceArtifact();

  // 1. Omitting diff-interface-version fails on interface_version step
  assert.throws(
    () =>
      runDifferentialTrace(
        artifact.traces[0],
        EXPECTED_DIFFERENCE_IDS.filter((id) => id !== "diff-interface-version"),
      ),
    /unexpected result divergence/,
  );

  // 2. Omitting diff-initialize-asset-policies-and-event fails on initialize step (AssetActivated event)
  assert.throws(
    () =>
      runDifferentialTrace(
        artifact.traces[0],
        EXPECTED_DIFFERENCE_IDS.filter((id) => id !== "diff-initialize-asset-policies-and-event"),
      ),
    /unexpected events divergence/,
  );

  // 3. Omitting diff-create-session-domain-id fails on create_session step
  assert.throws(
    () =>
      runDifferentialTrace(
        artifact.traces[0],
        EXPECTED_DIFFERENCE_IDS.filter((id) => id !== "diff-create-session-domain-id"),
      ),
    /unexpected result divergence/,
  );

  // 4. Omitting diff-session-audit-metadata fails on get_session step
  assert.throws(
    () =>
      runDifferentialTrace(
        artifact.traces[0],
        EXPECTED_DIFFERENCE_IDS.filter((id) => id !== "diff-session-audit-metadata"),
      ),
    /unexpected result divergence/,
  );
});

test("unexpected state, balance, error, or event differences fail verification", () => {
  const artifact = buildCrossVersionTraceArtifact();
  const v2Fixture = JSON.parse(
    readFileSync(join(repoRoot, "artifacts", "interface", "upto-session-v2.json"), "utf8"),
  );
  const v3Fixture = JSON.parse(
    readFileSync(join(repoRoot, "artifacts", "interface", "upto-session-v3.json"), "utf8"),
  );
  const migration = JSON.parse(
    readFileSync(join(repoRoot, "artifacts", "interface", "migrations", "v2-to-v3.json"), "utf8"),
  );

  // 1. Tampered terminal state fails
  const stateDrifted = structuredClone(artifact);
  stateDrifted.traces[0].normalizedSteps[4].terminalStates.s0 = "Cancelled";
  assert.throws(
    () =>
      verifyCrossVersionTraceArtifact({
        artifact: stateDrifted,
        v2Fixture,
        v3Fixture,
        migration,
      }),
    /drifted from deterministic replay/,
  );

  // 2. Tampered balance fails
  const balanceDrifted = structuredClone(artifact);
  balanceDrifted.traces[0].normalizedSteps[4].balances.seller = 299;
  assert.throws(
    () =>
      verifyCrossVersionTraceArtifact({
        artifact: balanceDrifted,
        v2Fixture,
        v3Fixture,
        migration,
      }),
    /drifted from deterministic replay/,
  );

  // 3. Tampered error code fails
  const errorDrifted = structuredClone(artifact);
  errorDrifted.traces[4].normalizedSteps[3].error = { name: "SessionCancelled", code: 7 };
  assert.throws(
    () =>
      verifyCrossVersionTraceArtifact({
        artifact: errorDrifted,
        v2Fixture,
        v3Fixture,
        migration,
      }),
    /drifted from deterministic replay/,
  );

  // 4. Tampered event payload fails
  const eventDrifted = structuredClone(artifact);
  eventDrifted.traces[0].normalizedSteps[4].events[0].data.actual_amount = 250;
  assert.throws(
    () =>
      verifyCrossVersionTraceArtifact({
        artifact: eventDrifted,
        v2Fixture,
        v3Fixture,
        migration,
      }),
    /drifted from deterministic replay/,
  );
});

test("reinterpreting a v2 session identifier on a v3 deployment (or vice versa) fails closed", () => {
  const v2 = createVersionRuntime(2, 1000);
  const v3 = createVersionRuntime(3, 1000);
  const v2Handles = new Map();
  const v3Handles = new Map();

  executeStep(v2, { op: "initialize", assets: ["asset:LBT"] }, v2Handles);
  executeStep(v3, { op: "initialize", assets: ["asset:LBT"] }, v3Handles);
  executeStep(
    v2,
    { op: "create_session", assignHandle: "s0", asset: "asset:LBT", maxAmount: 500, expiresAtLedger: 50 },
    v2Handles,
  );
  executeStep(
    v3,
    { op: "create_session", assignHandle: "s0", asset: "asset:LBT", maxAmount: 500, expiresAtLedger: 50 },
    v3Handles,
  );

  const v2RawId = v2Handles.get("s0");
  const v3RawId = v3Handles.get("s0");
  assert.notEqual(v2RawId, v3RawId);

  assert.throws(
    () => executeStep(v3, { op: "get_session", rawSessionId: v2RawId }, v3Handles),
    /Cross-deployment identifier reinterpretation forbidden/,
  );
  assert.throws(
    () => executeStep(v2, { op: "settle", rawSessionId: v3RawId, actualAmount: 100 }, v2Handles),
    /Cross-deployment identifier reinterpretation forbidden/,
  );
});
