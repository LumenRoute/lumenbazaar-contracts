import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const thisFile = fileURLToPath(import.meta.url);
export const repoRoot = join(dirname(thisFile), "..", "..");

export const TRACE_SCHEMA = "lumenbazaar/cross-version-behavior-traces";
export const SHARED_OPERATIONS = Object.freeze([
  "cancel",
  "create_session",
  "extend_ttl",
  "get_session",
  "initialize",
  "interface_version",
  "recover_expired",
  "settle",
]);

export const ERROR_CODES = Object.freeze({
  AlreadyInitialized: 1,
  Unauthorized: 2,
  InvalidAmount: 3,
  ExpiredSession: 4,
  SessionNotFound: 5,
  SessionAlreadySettled: 6,
  SessionCancelled: 7,
  AmountExceedsCap: 8,
  InvalidAsset: 9,
  InvalidSeller: 10,
  TtlExtensionFailed: 11,
  InvalidResourceHash: 12,
  InvalidUsageHash: 13,
  UnsupportedAsset: 14,
  InvalidSupportedAssets: 15,
  SessionDurationTooLong: 16,
  LiabilityOverflow: 17,
  LiabilityUnderflow: 18,
  EscrowUnderfunded: 19,
  NotInitialized: 20,
  SessionExpired: 21,
  SessionNotExpired: 22,
});

export const EXPECTED_DIFFERENCE_IDS = Object.freeze([
  "diff-interface-version",
  "diff-initialize-asset-policies-and-event",
  "diff-create-session-domain-id",
  "diff-session-audit-metadata",
]);

/**
 * Simulates an operation step against either the archived v2 or v3 behavioral
 * runtime model. Identifiers remain scoped to their deployment (`v2:session-N`
 * vs `v3:session-N`); passing a v2 session ID to a v3 runtime (or vice versa)
 * is rejected as a cross-deployment identifier reinterpretation fault.
 */
export function createVersionRuntime(version, initialBuyerBalance = 1000) {
  if (version !== 2 && version !== 3) {
    throw new Error(`Unsupported interface version: ${version}`);
  }
  return {
    version,
    initialized: false,
    ledger: 10,
    nextSequence: 0,
    supportedAssets: new Set(),
    balances: {
      buyer: initialBuyerBalance,
      seller: 0,
      contract: 0,
    },
    liability: 0,
    sessions: new Map(),
  };
}

function deriveDeploymentSessionId(version, sequence, step) {
  const preimage =
    version === 2
      ? `v2:${sequence}:${step.maxAmount}:${step.expiresAtLedger}:${step.resourceHash ?? "09".repeat(32)}`
      : `v3:lumenbazaar/session-id:${sequence}:${step.maxAmount}:${step.expiresAtLedger}:${step.resourceHash ?? "09".repeat(32)}:${step.idempotencyKey ?? "08".repeat(32)}`;
  const digest = createHash("sha256").update(preimage, "utf8").digest("hex").slice(0, 16);
  return `v${version}:session-${sequence}:${digest}`;
}

export function executeStep(runtime, step, handleMap) {
  const op = step.op;
  const events = [];
  let rawResult = null;
  let error = null;

  const fail = (errorName) => {
    const code = ERROR_CODES[errorName];
    if (!code) {
      throw new Error(`Unknown error name: ${errorName}`);
    }
    error = { name: errorName, code };
  };

  const resolveSessionId = (stepArg) => {
    if (stepArg.rawSessionId) {
      if (!stepArg.rawSessionId.startsWith(`v${runtime.version}:`)) {
        throw new Error(
          `Cross-deployment identifier reinterpretation forbidden: cannot use "${stepArg.rawSessionId}" on v${runtime.version} deployment`,
        );
      }
      return stepArg.rawSessionId;
    }
    const handle = stepArg.sessionHandle ?? "s0";
    return handleMap.get(handle) ?? `v${runtime.version}:missing:${handle}`;
  };

  if (op === "advance_ledger") {
    if (!Number.isInteger(step.ledger) || step.ledger < runtime.ledger) {
      throw new Error(`Invalid advance_ledger target: ${step.ledger}`);
    }
    runtime.ledger = step.ledger;
    rawResult = { ledger: runtime.ledger };
  } else if (op === "interface_version") {
    rawResult = runtime.version;
  } else if (op === "initialize") {
    if (step.adminAuthorized === false) {
      fail("Unauthorized");
    } else if (runtime.initialized) {
      fail("AlreadyInitialized");
    } else if (!Array.isArray(step.assets) || step.assets.length === 0) {
      fail("InvalidSupportedAssets");
    } else {
      runtime.initialized = true;
      for (const asset of step.assets) {
        runtime.supportedAssets.add(asset);
        if (runtime.version === 3) {
          events.push({
            name: "AssetActivated",
            prefixTopic: "asset_activated",
            topic: asset,
            eventVersion: 3,
            data: { decimals: 7 },
          });
        }
      }
      rawResult = "void";
    }
  } else if (op === "create_session") {
    const asset = step.asset ?? "asset:LBT";
    const buyer = step.buyer ?? "addr:buyer";
    const seller = step.seller ?? "addr:seller";
    const maxAmount = Number(step.maxAmount);
    const expiresAtLedger = Number(step.expiresAtLedger);
    const resourceHash = step.resourceHash ?? "09".repeat(32);

    if (!runtime.initialized) {
      fail("NotInitialized");
    } else if (step.buyerAuthorized === false) {
      fail("Unauthorized");
    } else if (!runtime.supportedAssets.has(asset)) {
      fail("UnsupportedAsset");
    } else if (buyer === seller) {
      fail("InvalidSeller");
    } else if (asset === buyer || asset === seller) {
      fail("InvalidAsset");
    } else if (!Number.isFinite(maxAmount) || maxAmount <= 0) {
      fail("InvalidAmount");
    } else if (expiresAtLedger <= runtime.ledger) {
      fail("ExpiredSession");
    } else if (/^0+$/.test(resourceHash)) {
      fail("InvalidResourceHash");
    } else {
      const seq = runtime.nextSequence;
      runtime.nextSequence += 1;
      const sessionId = deriveDeploymentSessionId(runtime.version, seq, step);
      const handle = step.assignHandle ?? `s${seq}`;
      handleMap.set(handle, sessionId);

      runtime.balances.buyer -= maxAmount;
      runtime.balances.contract += maxAmount;
      runtime.liability += maxAmount;

      const session = {
        id: sessionId,
        handle,
        buyer,
        seller,
        asset,
        max_amount: maxAmount,
        escrowed_amount: maxAmount,
        settled_amount: 0,
        expires_at_ledger: expiresAtLedger,
        resource_hash: resourceHash,
        usage_hash: null,
        status: "Open",
        ttl_extended_at_ledger: runtime.ledger,
        ...(runtime.version === 3
          ? {
              creation_ledger: runtime.ledger,
              finalized_ledger: null,
              resource_scheme_version: 1,
              usage_scheme_version: null,
            }
          : {}),
      };
      runtime.sessions.set(sessionId, session);
      events.push({
        name: "SessionCreated",
        prefixTopic: "session_created",
        topic: handle,
        eventVersion: 2,
        data: {
          buyer,
          seller,
          asset,
          max_amount: maxAmount,
          escrowed_amount: maxAmount,
          expires_at_ledger: expiresAtLedger,
          resource_hash: resourceHash,
        },
      });
      rawResult = {
        sessionHandle: handle,
        sessionIdScheme:
          runtime.version === 2
            ? "v2-flat-tuple-sha256"
            : "v3-domain-separated-xdr-sha256",
      };
    }
  } else if (op === "get_session") {
    const sessionId = resolveSessionId(step);
    const session = runtime.sessions.get(sessionId);
    if (!session) {
      fail("SessionNotFound");
    } else {
      rawResult = structuredClone(session);
    }
  } else if (op === "settle") {
    const sessionId = resolveSessionId(step);
    const session = runtime.sessions.get(sessionId);
    const actualAmount = Number(step.actualAmount);
    const usageHash = step.usageHash ?? "11".repeat(32);

    if (!session) {
      fail("SessionNotFound");
    } else if (session.status === "Settled") {
      fail("SessionAlreadySettled");
    } else if (session.status === "Cancelled") {
      fail("SessionCancelled");
    } else if (session.status === "Expired") {
      fail("SessionExpired");
    } else if (runtime.ledger >= session.expires_at_ledger) {
      fail("ExpiredSession");
    } else if (step.sellerAuthorized === false) {
      fail("Unauthorized");
    } else if (!Number.isFinite(actualAmount) || actualAmount <= 0) {
      fail("InvalidAmount");
    } else if (actualAmount > session.max_amount) {
      fail("AmountExceedsCap");
    } else if (/^0+$/.test(usageHash)) {
      fail("InvalidUsageHash");
    } else {
      const refund = session.escrowed_amount - actualAmount;
      session.status = "Settled";
      session.settled_amount = actualAmount;
      session.escrowed_amount = 0;
      session.usage_hash = usageHash;
      if (runtime.version === 3) {
        session.finalized_ledger = runtime.ledger;
        session.usage_scheme_version = 1;
      }
      runtime.balances.contract -= session.max_amount;
      runtime.balances.seller += actualAmount;
      runtime.balances.buyer += refund;
      runtime.liability -= session.max_amount;

      events.push({
        name: "SessionSettled",
        prefixTopic: "session_settled",
        topic: session.handle,
        eventVersion: 2,
        data: {
          seller: session.seller,
          asset: session.asset,
          actual_amount: actualAmount,
          refunded_amount: refund,
          usage_hash: usageHash,
        },
      });
      rawResult = "void";
    }
  } else if (op === "cancel") {
    const sessionId = resolveSessionId(step);
    const session = runtime.sessions.get(sessionId);

    if (!session) {
      fail("SessionNotFound");
    } else if (session.status === "Settled") {
      fail("SessionAlreadySettled");
    } else if (session.status === "Cancelled") {
      fail("SessionCancelled");
    } else if (session.status === "Expired") {
      fail("SessionExpired");
    } else if (runtime.ledger >= session.expires_at_ledger) {
      fail("ExpiredSession");
    } else if (step.buyerAuthorized === false) {
      fail("Unauthorized");
    } else {
      const refund = session.escrowed_amount;
      session.status = "Cancelled";
      session.escrowed_amount = 0;
      if (runtime.version === 3) {
        session.finalized_ledger = runtime.ledger;
      }
      runtime.balances.contract -= refund;
      runtime.balances.buyer += refund;
      runtime.liability -= refund;

      events.push({
        name: "SessionCancelled",
        prefixTopic: "session_cancelled",
        topic: session.handle,
        eventVersion: 2,
        data: {
          buyer: session.buyer,
          asset: session.asset,
          refunded_amount: refund,
        },
      });
      rawResult = "void";
    }
  } else if (op === "recover_expired") {
    const sessionId = resolveSessionId(step);
    const session = runtime.sessions.get(sessionId);

    if (!session) {
      fail("SessionNotFound");
    } else if (session.status === "Settled") {
      fail("SessionAlreadySettled");
    } else if (session.status === "Cancelled") {
      fail("SessionCancelled");
    } else if (session.status === "Expired") {
      fail("SessionExpired");
    } else if (runtime.ledger < session.expires_at_ledger) {
      fail("SessionNotExpired");
    } else {
      const refund = session.escrowed_amount;
      session.status = "Expired";
      session.escrowed_amount = 0;
      if (runtime.version === 3) {
        session.finalized_ledger = runtime.ledger;
      }
      runtime.balances.contract -= refund;
      runtime.balances.buyer += refund;
      runtime.liability -= refund;

      events.push({
        name: "SessionRecovered",
        prefixTopic: "session_recovered",
        topic: session.handle,
        eventVersion: 2,
        data: {
          buyer: session.buyer,
          asset: session.asset,
          refunded_amount: refund,
          expired_at_ledger: session.expires_at_ledger,
          recovered_at_ledger: runtime.ledger,
        },
      });
      rawResult = "void";
    }
  } else if (op === "extend_ttl") {
    const sessionId = resolveSessionId(step);
    const session = runtime.sessions.get(sessionId);

    if (!session) {
      fail("SessionNotFound");
    } else if (session.status !== "Open") {
      fail("TtlExtensionFailed");
    } else {
      session.ttl_extended_at_ledger = runtime.ledger;
      rawResult = "void";
    }
  } else {
    throw new Error(`Unsupported trace operation: ${op}`);
  }

  return {
    op,
    outcome: error ? "err" : "ok",
    error,
    rawResult,
    events,
    balances: structuredClone(runtime.balances),
    liability: runtime.liability,
    terminalStates: Object.fromEntries(
      [...runtime.sessions.values()].map((s) => [s.handle, s.status]),
    ),
  };
}

/**
 * Normalizes a v2 or v3 step observation using the explicit expected-difference
 * fixtures. Any difference NOT covered by `allowedDifferenceIds` remains in the
 * normalized record and causes comparison to fail.
 */
export function normalizeStepObservation(obs, allowedDifferenceIds) {
  const allowed = new Set(allowedDifferenceIds);
  let normalizedResult = structuredClone(obs.rawResult);
  let normalizedEvents = structuredClone(obs.events);
  const appliedDifferences = [];

  if (obs.op === "interface_version" && obs.outcome === "ok") {
    if (allowed.has("diff-interface-version")) {
      normalizedResult = "INTERFACE_VERSION_MATCHED_FIXTURE";
      appliedDifferences.push("diff-interface-version");
    }
  }

  if (obs.op === "initialize" && obs.outcome === "ok") {
    if (allowed.has("diff-initialize-asset-policies-and-event")) {
      normalizedEvents = normalizedEvents.filter((e) => e.name !== "AssetActivated");
      appliedDifferences.push("diff-initialize-asset-policies-and-event");
    }
  }

  if (obs.op === "create_session" && obs.outcome === "ok" && normalizedResult) {
    if (allowed.has("diff-create-session-domain-id")) {
      normalizedResult = {
        sessionHandle: normalizedResult.sessionHandle,
        sessionIdScheme: "DEPLOYMENT_SCOPED_SESSION_ID",
      };
      appliedDifferences.push("diff-create-session-domain-id");
    }
  }

  if (obs.op === "get_session" && obs.outcome === "ok" && normalizedResult) {
    const copy = { ...normalizedResult };
    delete copy.id;
    if (allowed.has("diff-session-audit-metadata")) {
      delete copy.creation_ledger;
      delete copy.finalized_ledger;
      delete copy.resource_scheme_version;
      delete copy.usage_scheme_version;
      appliedDifferences.push("diff-session-audit-metadata");
    }
    normalizedResult = copy;
  }

  return {
    op: obs.op,
    outcome: obs.outcome,
    error: obs.error,
    result: normalizedResult,
    events: normalizedEvents,
    balances: obs.balances,
    liability: obs.liability,
    terminalStates: obs.terminalStates,
    appliedDifferences,
  };
}

export function runDifferentialTrace(trace, expectedDifferenceIds = EXPECTED_DIFFERENCE_IDS) {
  const v2 = createVersionRuntime(2, trace.initialBuyerBalance ?? 1000);
  const v3 = createVersionRuntime(3, trace.initialBuyerBalance ?? 1000);
  const v2Handles = new Map();
  const v3Handles = new Map();
  const normalizedSteps = [];

  for (let index = 0; index < trace.steps.length; index += 1) {
    const step = trace.steps[index];
    const v2Obs = executeStep(v2, step, v2Handles);
    const v3Obs = executeStep(v3, step, v3Handles);

    // Verify deployment-scoped session IDs are never identical between v2 and v3
    if (step.op === "create_session" && v2Obs.outcome === "ok" && v3Obs.outcome === "ok") {
      const handle = step.assignHandle ?? "s0";
      if (v2Handles.get(handle) === v3Handles.get(handle)) {
        throw new Error(`Trace ${trace.name} step ${index}: v2 and v3 produced identical raw session IDs`);
      }
    }

    const v2Norm = normalizeStepObservation(v2Obs, expectedDifferenceIds);
    const v3Norm = normalizeStepObservation(v3Obs, expectedDifferenceIds);

    const compareFields = ["outcome", "error", "result", "events", "balances", "liability", "terminalStates"];
    for (const field of compareFields) {
      const left = JSON.stringify(v2Norm[field]);
      const right = JSON.stringify(v3Norm[field]);
      if (left !== right) {
        throw new Error(
          `Trace "${trace.name}" step ${index} (${step.op}) unexpected ${field} divergence:\n  v2: ${left}\n  v3: ${right}`,
        );
      }
    }

    normalizedSteps.push({
      stepIndex: index,
      op: step.op,
      outcome: v2Norm.outcome,
      error: v2Norm.error,
      result: v2Norm.result,
      events: v2Norm.events,
      balances: v2Norm.balances,
      liability: v2Norm.liability,
      terminalStates: v2Norm.terminalStates,
      appliedDifferences: [...new Set([...v2Norm.appliedDifferences, ...v3Norm.appliedDifferences])].sort(),
    });
  }

  return {
    name: trace.name,
    description: trace.description,
    initialBuyerBalance: trace.initialBuyerBalance ?? 1000,
    steps: trace.steps,
    normalizedSteps,
  };
}

export function buildCrossVersionTraceArtifact() {
  const expectedDifferences = [
    {
      id: "diff-interface-version",
      operation: "interface_version",
      field: "result",
      v2Value: 2,
      v3Value: 3,
      rationale: "Each replacement deployment reports its frozen major interface version.",
    },
    {
      id: "diff-initialize-asset-policies-and-event",
      operation: "initialize",
      field: "events",
      v2Value: [],
      v3Value: ["AssetActivated"],
      rationale:
        "v2 records a boolean supported-asset flag with no event; v3 validates SEP-41 asset policies, sets AssetStatus::Active, and emits AssetActivated (event_version 3).",
    },
    {
      id: "diff-create-session-domain-id",
      operation: "create_session",
      field: "session_id_scheme",
      v2Value: "v2-flat-tuple-sha256",
      v3Value: "v3-domain-separated-xdr-sha256",
      rationale:
        "v3 session IDs hash domain-separated ScVal XDR (domain_xdr, payload_xdr) including idempotency_key; identifiers are deployment-scoped and never reinterpreted across contracts.",
    },
    {
      id: "diff-session-audit-metadata",
      operation: "get_session",
      field: "v3_only_session_fields",
      v2Value: null,
      v3Value: [
        "creation_ledger",
        "finalized_ledger",
        "resource_scheme_version",
        "usage_scheme_version",
      ],
      rationale:
        "v3 appends audit ledger and commitment scheme version metadata to Session while preserving all shared v2 session fields, status transitions, events, and balances.",
    },
  ];

  const traceDefinitions = [
    {
      name: "partial_settlement_lifecycle",
      description:
        "Shared initialize, create_session, get_session, and partial settle preserve seller payout, buyer refund, events, zero liability, and Settled terminal state.",
      initialBuyerBalance: 1000,
      steps: [
        { op: "interface_version" },
        { op: "initialize", assets: ["asset:LBT"] },
        {
          op: "create_session",
          assignHandle: "s0",
          asset: "asset:LBT",
          maxAmount: 500,
          expiresAtLedger: 50,
        },
        { op: "get_session", sessionHandle: "s0" },
        { op: "settle", sessionHandle: "s0", actualAmount: 300 },
        { op: "get_session", sessionHandle: "s0" },
      ],
    },
    {
      name: "exact_cap_settlement_lifecycle",
      description:
        "Settling for the exact escrowed cap transfers 100% to seller, refunds 0 to buyer, clears liability, and transitions to Settled.",
      initialBuyerBalance: 1000,
      steps: [
        { op: "initialize", assets: ["asset:LBT"] },
        {
          op: "create_session",
          assignHandle: "s0",
          asset: "asset:LBT",
          maxAmount: 500,
          expiresAtLedger: 50,
        },
        { op: "settle", sessionHandle: "s0", actualAmount: 500 },
        { op: "get_session", sessionHandle: "s0" },
      ],
    },
    {
      name: "buyer_cancellation_and_ttl_extension_lifecycle",
      description:
        "Open session TTL extension emits no event and preserves state; buyer cancellation before expiry refunds full cap and transitions to Cancelled.",
      initialBuyerBalance: 1000,
      steps: [
        { op: "initialize", assets: ["asset:LBT"] },
        {
          op: "create_session",
          assignHandle: "s0",
          asset: "asset:LBT",
          maxAmount: 400,
          expiresAtLedger: 50,
        },
        { op: "extend_ttl", sessionHandle: "s0" },
        { op: "cancel", sessionHandle: "s0" },
        { op: "get_session", sessionHandle: "s0" },
      ],
    },
    {
      name: "expiry_recovery_lifecycle",
      description:
        "At or after expires_at_ledger, recover_expired refunds the full escrowed amount to the stored buyer and transitions to Expired.",
      initialBuyerBalance: 1000,
      steps: [
        { op: "initialize", assets: ["asset:LBT"] },
        {
          op: "create_session",
          assignHandle: "s0",
          asset: "asset:LBT",
          maxAmount: 600,
          expiresAtLedger: 50,
        },
        { op: "advance_ledger", ledger: 50 },
        { op: "recover_expired", sessionHandle: "s0" },
        { op: "get_session", sessionHandle: "s0" },
      ],
    },
    {
      name: "terminal_immutability_and_double_exit_rejections",
      description:
        "Once finalized (Settled, Cancelled, or Expired), every subsequent settle, cancel, recover_expired, or extend_ttl fails with identical error codes and zero state change.",
      initialBuyerBalance: 1000,
      steps: [
        { op: "initialize", assets: ["asset:LBT"] },
        {
          op: "create_session",
          assignHandle: "s0",
          asset: "asset:LBT",
          maxAmount: 500,
          expiresAtLedger: 50,
        },
        { op: "settle", sessionHandle: "s0", actualAmount: 200 },
        { op: "settle", sessionHandle: "s0", actualAmount: 100 },
        { op: "cancel", sessionHandle: "s0" },
        { op: "recover_expired", sessionHandle: "s0" },
        { op: "extend_ttl", sessionHandle: "s0" },
      ],
    },
    {
      name: "expiry_and_amount_boundary_rejections",
      description:
        "Zero/negative amounts, over-cap settlements, premature recovery before expiry, and settle/cancel at expiry fail with identical error codes without moving funds.",
      initialBuyerBalance: 1000,
      steps: [
        { op: "initialize", assets: ["asset:LBT"] },
        {
          op: "create_session",
          assignHandle: "s_invalid",
          asset: "asset:LBT",
          maxAmount: 0,
          expiresAtLedger: 50,
        },
        {
          op: "create_session",
          assignHandle: "s0",
          asset: "asset:LBT",
          maxAmount: 500,
          expiresAtLedger: 50,
        },
        { op: "settle", sessionHandle: "s0", actualAmount: 0 },
        { op: "settle", sessionHandle: "s0", actualAmount: 501 },
        { op: "advance_ledger", ledger: 49 },
        { op: "recover_expired", sessionHandle: "s0" },
        { op: "advance_ledger", ledger: 50 },
        { op: "settle", sessionHandle: "s0", actualAmount: 100 },
        { op: "cancel", sessionHandle: "s0" },
        { op: "extend_ttl", sessionHandle: "s0" },
        { op: "recover_expired", sessionHandle: "s0" },
        { op: "recover_expired", sessionHandle: "s0" },
      ],
    },
    {
      name: "unauthorized_and_missing_session_rejections",
      description:
        "Missing session lookups and unauthenticated initialize, create_session, settle, and cancel calls fail closed with identical error codes.",
      initialBuyerBalance: 1000,
      steps: [
        { op: "initialize", assets: ["asset:LBT"], adminAuthorized: false },
        { op: "initialize", assets: ["asset:LBT"] },
        { op: "get_session", sessionHandle: "unknown" },
        {
          op: "create_session",
          assignHandle: "s_unauth",
          asset: "asset:LBT",
          maxAmount: 500,
          expiresAtLedger: 50,
          buyerAuthorized: false,
        },
        {
          op: "create_session",
          assignHandle: "s0",
          asset: "asset:LBT",
          maxAmount: 500,
          expiresAtLedger: 50,
        },
        { op: "settle", sessionHandle: "s0", actualAmount: 100, sellerAuthorized: false },
        { op: "cancel", sessionHandle: "s0", buyerAuthorized: false },
      ],
    },
  ];

  const diffIds = expectedDifferences.map((d) => d.id);
  const traces = traceDefinitions.map((t) => runDifferentialTrace(t, diffIds));

  return {
    schema: TRACE_SCHEMA,
    version: 1,
    fromInterfaceVersion: 2,
    toInterfaceVersion: 3,
    sharedOperations: [...SHARED_OPERATIONS],
    identifierIsolationRule:
      "Session IDs are deployment-scoped (v2: legacy tuple hash; v3: domain-separated ScVal XDR hash with idempotency_key). Traces normalize session handles within each deployment and forbid cross-deployment identifier reinterpretation.",
    expectedDifferences,
    traces,
  };
}

export function verifyCrossVersionTraceArtifact({
  artifact,
  v2Fixture,
  v3Fixture,
  migration,
}) {
  if (!artifact || artifact.schema !== TRACE_SCHEMA || artifact.version !== 1) {
    throw new Error(`Artifact must declare schema "${TRACE_SCHEMA}" and version 1.`);
  }
  if (artifact.fromInterfaceVersion !== 2 || artifact.toInterfaceVersion !== 3) {
    throw new Error("Artifact must compare interfaceVersion 2 and interfaceVersion 3.");
  }
  if (
    migration.fromInterfaceVersion !== artifact.fromInterfaceVersion ||
    migration.toInterfaceVersion !== artifact.toInterfaceVersion
  ) {
    throw new Error("Migration record versions do not match differential trace artifact.");
  }

  // Verify sharedOperations is the exact intersection of v2 and v3 methods
  const v3MethodSet = new Set(v3Fixture.methods);
  const actualShared = v2Fixture.methods.filter((m) => v3MethodSet.has(m)).sort();
  if (
    !Array.isArray(artifact.sharedOperations) ||
    artifact.sharedOperations.join(",") !== actualShared.join(",")
  ) {
    throw new Error(
      `sharedOperations (${JSON.stringify(artifact.sharedOperations)}) does not match v2/v3 intersection (${JSON.stringify(actualShared)}).`,
    );
  }

  // Verify retained v2 errors match v3 error codes
  const v3ErrorMap = new Map(v3Fixture.errors.map((e) => [e.name, e.value]));
  for (const v2Err of v2Fixture.errors) {
    if (v3ErrorMap.get(v2Err.name) !== v2Err.value) {
      throw new Error(`Retained error ${v2Err.name} changed code between v2 and v3.`);
    }
  }

  if (!Array.isArray(artifact.expectedDifferences) || artifact.expectedDifferences.length === 0) {
    throw new Error("expectedDifferences must be a non-empty array of explicit version difference fixtures.");
  }
  const diffIds = artifact.expectedDifferences.map((d) => d.id);
  for (const expectedId of EXPECTED_DIFFERENCE_IDS) {
    if (!diffIds.includes(expectedId)) {
      throw new Error(`Missing required expectedDifference fixture "${expectedId}".`);
    }
  }

  if (!Array.isArray(artifact.traces) || artifact.traces.length === 0) {
    throw new Error("traces must be a non-empty array.");
  }

  const coveredOps = new Set();
  for (const trace of artifact.traces) {
    const replayed = runDifferentialTrace(trace, diffIds);
    if (JSON.stringify(replayed.normalizedSteps) !== JSON.stringify(trace.normalizedSteps)) {
      throw new Error(`Committed normalizedSteps for trace "${trace.name}" drifted from deterministic replay.`);
    }
    for (const step of trace.steps) {
      if (SHARED_OPERATIONS.includes(step.op)) {
        coveredOps.add(step.op);
      }
    }
  }

  for (const sharedOp of SHARED_OPERATIONS) {
    if (!coveredOps.has(sharedOp)) {
      throw new Error(`Shared operation "${sharedOp}" is not covered by any differential trace.`);
    }
  }

  return {
    traceCount: artifact.traces.length,
    sharedOperations: actualShared,
    expectedDifferenceCount: artifact.expectedDifferences.length,
  };
}

export function loadAndVerifyCrossVersionTraces(root = repoRoot) {
  const artifact = JSON.parse(
    readFileSync(join(root, "artifacts", "interface", "cross-version-behavior-traces.json"), "utf8"),
  );
  const v2Fixture = JSON.parse(
    readFileSync(join(root, "artifacts", "interface", "upto-session-v2.json"), "utf8"),
  );
  const v3Fixture = JSON.parse(
    readFileSync(join(root, "artifacts", "interface", "upto-session-v3.json"), "utf8"),
  );
  const migration = JSON.parse(
    readFileSync(join(root, "artifacts", "interface", "migrations", "v2-to-v3.json"), "utf8"),
  );
  return verifyCrossVersionTraceArtifact({
    artifact,
    v2Fixture,
    v3Fixture,
    migration,
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.includes("--write")) {
    const outPath = join(repoRoot, "artifacts", "interface", "cross-version-behavior-traces.json");
    writeFileSync(outPath, `${JSON.stringify(buildCrossVersionTraceArtifact(), null, 2)}\n`, "utf8");
  }
  const summary = loadAndVerifyCrossVersionTraces(repoRoot);
  console.log(
    `cross-version behavioral differential traces passed (${summary.traceCount} traces across ${summary.sharedOperations.length} shared operations)`,
  );
}
