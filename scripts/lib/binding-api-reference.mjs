import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Curated metadata for every public method in the frozen upto-session v3 spec.
 * Adding, removing, or renaming a public contract method without updating this
 * table fails generation and CI drift checks.
 */
export const METHOD_METADATA = Object.freeze({
  accept_admin: {
    category: "Governance & Admin Rotation",
    authorization: "Pending admin (`pending_admin.require_auth()`)",
    securitySensitive: true,
    summary: "Completes two-step administrator rotation before the proposal expiry ledger.",
    links: [
      "[Handoff: Admin Rotation](../../docs/backend-integration-handoff.md#upto-session-functions)",
      "[Security Checklist](../../docs/security-checklist.md)",
      "[Storage Lifecycle](../../docs/storage-lifecycle.md)",
    ],
  },
  accept_asset_cap_increase: {
    category: "Asset Cap & Exposure Policy",
    authorization: "Active admin (`admin.require_auth()`)",
    securitySensitive: true,
    summary: "Activates a time-locked per-asset session cap increase after its activation delay and before expiry.",
    links: [
      "[Handoff: Asset Cap Policy](../../docs/backend-integration-handoff.md#upto-session-functions)",
      "[Security Checklist](../../docs/security-checklist.md)",
    ],
  },
  activate_asset: {
    category: "Asset Lifecycle",
    authorization: "Active admin (`admin.require_auth()`)",
    securitySensitive: true,
    summary: "Probes a SEP-41 token contract and activates it with bounded session and exposure ceilings.",
    links: [
      "[Handoff: Asset Lifecycle](../../docs/backend-integration-handoff.md#v2-to-v3-compatibility)",
      "[Security Checklist](../../docs/security-checklist.md)",
      "[Storage Lifecycle](../../docs/storage-lifecycle.md)",
    ],
  },
  cancel: {
    category: "Session Lifecycle",
    authorization: "Buyer (`session.buyer.require_auth()`)",
    securitySensitive: true,
    summary: "Cancels an open, unexpired session and refunds the full escrowed amount to the stored buyer.",
    links: [
      "[Handoff: Session Exits](../../docs/backend-integration-handoff.md#upto-session-functions)",
      "[Security Checklist](../../docs/security-checklist.md)",
      "[Storage Lifecycle](../../docs/storage-lifecycle.md)",
    ],
  },
  cancel_admin_rotation: {
    category: "Governance & Admin Rotation",
    authorization: "Active admin (`admin.require_auth()`)",
    securitySensitive: true,
    summary: "Cancels a pending or expired administrator rotation proposal.",
    links: [
      "[Handoff: Admin Rotation](../../docs/backend-integration-handoff.md#upto-session-functions)",
      "[Security Checklist](../../docs/security-checklist.md)",
    ],
  },
  cancel_asset_cap_increase: {
    category: "Asset Cap & Exposure Policy",
    authorization: "Active admin (`admin.require_auth()`)",
    securitySensitive: true,
    summary: "Cancels a pending per-asset session cap increase proposal.",
    links: [
      "[Handoff: Asset Cap Policy](../../docs/backend-integration-handoff.md#upto-session-functions)",
      "[Security Checklist](../../docs/security-checklist.md)",
    ],
  },
  create_session: {
    category: "Session Lifecycle",
    authorization: "Buyer (`buyer.require_auth()`)",
    securitySensitive: true,
    summary: "Creates a domain-separated v3 escrow session with per-buyer idempotency and transfers `max_amount` into contract custody.",
    links: [
      "[Handoff: Session Creation & Domain Separation](../../docs/backend-integration-handoff.md#v2-to-v3-compatibility)",
      "[Security Checklist](../../docs/security-checklist.md)",
      "[Storage Lifecycle](../../docs/storage-lifecycle.md)",
    ],
  },
  deprecate_asset: {
    category: "Asset Lifecycle",
    authorization: "Active admin (`admin.require_auth()`)",
    securitySensitive: true,
    summary: "Transitions an active asset to `Deprecated` with a 32-byte reason commitment, blocking new sessions while preserving open session exits.",
    links: [
      "[Handoff: Asset Deprecation](../../docs/backend-integration-handoff.md#v2-to-v3-compatibility)",
      "[Security Checklist](../../docs/security-checklist.md)",
    ],
  },
  extend_session_expiry: {
    category: "Session Lifecycle",
    authorization: "Buyer and Seller (`buyer.require_auth()` + `seller.require_auth()`)",
    securitySensitive: true,
    summary: "Extends `expires_at_ledger` for an open, unexpired session within `MAX_SESSION_DURATION_LEDGERS`.",
    links: [
      "[Handoff: Session Lifecycle](../../docs/backend-integration-handoff.md#upto-session-functions)",
      "[Security Checklist](../../docs/security-checklist.md)",
      "[Storage Lifecycle](../../docs/storage-lifecycle.md)",
    ],
  },
  extend_ttl: {
    category: "Storage & TTL Maintenance",
    authorization: "Permissionless (open sessions only)",
    securitySensitive: true,
    summary: "Extends persistent storage TTL for an open session and its associated liability/exposure counters.",
    links: [
      "[Storage Lifecycle](../../docs/storage-lifecycle.md)",
      "[Handoff: Missing or Expired State](../../docs/backend-integration-handoff.md#missing-or-expired-on-chain-state)",
    ],
  },
  get_admin: {
    category: "Governance & Admin Rotation",
    authorization: "Read-only (none)",
    securitySensitive: false,
    summary: "Returns the active administrator address.",
    links: ["[Handoff: Upto Session Functions](../../docs/backend-integration-handoff.md#upto-session-functions)"],
  },
  get_admin_rotation: {
    category: "Governance & Admin Rotation",
    authorization: "Read-only (none)",
    securitySensitive: false,
    summary: "Returns the optional pending `AdminRotation` proposal and expiry ledger.",
    links: ["[Handoff: Upto Session Functions](../../docs/backend-integration-handoff.md#upto-session-functions)"],
  },
  get_asset_cap_increase: {
    category: "Asset Cap & Exposure Policy",
    authorization: "Read-only (none)",
    securitySensitive: false,
    summary: "Returns the optional pending `CapIncreaseProposal` for a supported asset.",
    links: ["[Handoff: Upto Session Functions](../../docs/backend-integration-handoff.md#upto-session-functions)"],
  },
  get_asset_exposure_ceiling: {
    category: "Asset Cap & Exposure Policy",
    authorization: "Read-only (none)",
    securitySensitive: false,
    summary: "Returns the configured aggregate open escrow liability ceiling for an asset.",
    links: ["[Handoff: Upto Session Functions](../../docs/backend-integration-handoff.md#upto-session-functions)"],
  },
  get_asset_max_session_amount: {
    category: "Asset Cap & Exposure Policy",
    authorization: "Read-only (none)",
    securitySensitive: false,
    summary: "Returns the maximum `max_amount` permitted when creating a new session for an asset.",
    links: ["[Handoff: Upto Session Functions](../../docs/backend-integration-handoff.md#upto-session-functions)"],
  },
  get_asset_min_session_amount: {
    category: "Asset Cap & Exposure Policy",
    authorization: "Read-only (none)",
    securitySensitive: false,
    summary: "Returns the minimum `max_amount` permitted when creating or reducing a session for an asset.",
    links: ["[Handoff: Upto Session Functions](../../docs/backend-integration-handoff.md#upto-session-functions)"],
  },
  get_asset_policy: {
    category: "Asset Cap & Exposure Policy",
    authorization: "Read-only (none)",
    securitySensitive: false,
    summary: "Returns the full `AssetPolicy` record for a configured asset.",
    links: ["[Handoff: Upto Session Functions](../../docs/backend-integration-handoff.md#upto-session-functions)"],
  },
  get_asset_solvency: {
    category: "Solvency & Liability Accounting",
    authorization: "Read-only (none)",
    securitySensitive: false,
    summary: "Returns `AssetSolvency` (`state`, `balance`, `liability`, `surplus`) for a single configured asset.",
    links: ["[Handoff: Upto Session Functions](../../docs/backend-integration-handoff.md#upto-session-functions)"],
  },
  get_buyer_exposure: {
    category: "Asset Cap & Exposure Policy",
    authorization: "Read-only (none)",
    securitySensitive: false,
    summary: "Returns a buyer's current open escrow exposure for an asset.",
    links: ["[Handoff: Upto Session Functions](../../docs/backend-integration-handoff.md#upto-session-functions)"],
  },
  get_buyer_exposure_ceiling: {
    category: "Asset Cap & Exposure Policy",
    authorization: "Read-only (none)",
    securitySensitive: false,
    summary: "Returns the configured per-buyer open escrow exposure ceiling for an asset.",
    links: ["[Handoff: Upto Session Functions](../../docs/backend-integration-handoff.md#upto-session-functions)"],
  },
  get_buyer_open_sessions: {
    category: "Asset Cap & Exposure Policy",
    authorization: "Read-only (none)",
    securitySensitive: false,
    summary: "Returns the number of currently open sessions for a buyer.",
    links: ["[Handoff: Upto Session Functions](../../docs/backend-integration-handoff.md#upto-session-functions)"],
  },
  get_commitment_domain_metadata: {
    category: "Configuration & Version Discovery",
    authorization: "Read-only (none)",
    securitySensitive: false,
    summary: "Returns versioned commitment domain labels and active resource/usage scheme metadata.",
    links: ["[Handoff: V2 to V3 Compatibility](../../docs/backend-integration-handoff.md#v2-to-v3-compatibility)"],
  },
  get_configuration: {
    category: "Configuration & Version Discovery",
    authorization: "Read-only (none)",
    securitySensitive: false,
    summary: "Returns `ContractConfiguration` including interface/storage versions, admin, supported assets, operational state, TTL policy, and max session duration.",
    links: ["[Handoff: Upto Session Functions](../../docs/backend-integration-handoff.md#upto-session-functions)"],
  },
  get_escrow_liability: {
    category: "Solvency & Liability Accounting",
    authorization: "Read-only (none)",
    securitySensitive: false,
    summary: "Returns the aggregate open-session escrow liability recorded for a supported asset.",
    links: ["[Handoff: Upto Session Functions](../../docs/backend-integration-handoff.md#upto-session-functions)"],
  },
  get_max_buyer_open_sessions: {
    category: "Asset Cap & Exposure Policy",
    authorization: "Read-only (none)",
    securitySensitive: false,
    summary: "Returns the optional global limit on concurrent open sessions per buyer.",
    links: ["[Handoff: Upto Session Functions](../../docs/backend-integration-handoff.md#upto-session-functions)"],
  },
  get_max_seller_open_sessions: {
    category: "Asset Cap & Exposure Policy",
    authorization: "Read-only (none)",
    securitySensitive: false,
    summary: "Returns the optional global limit on concurrent open sessions per seller.",
    links: ["[Handoff: Upto Session Functions](../../docs/backend-integration-handoff.md#upto-session-functions)"],
  },
  get_recoverability: {
    category: "Session Lifecycle",
    authorization: "Read-only (none)",
    securitySensitive: false,
    summary: "Returns versioned `SessionRecoverability` metadata indicating whether an expired session can be recovered.",
    links: ["[Handoff: Upto Session Functions](../../docs/backend-integration-handoff.md#upto-session-functions)"],
  },
  get_seller_exposure: {
    category: "Asset Cap & Exposure Policy",
    authorization: "Read-only (none)",
    securitySensitive: false,
    summary: "Returns a seller's current open escrow exposure for an asset.",
    links: ["[Handoff: Upto Session Functions](../../docs/backend-integration-handoff.md#upto-session-functions)"],
  },
  get_seller_exposure_ceiling: {
    category: "Asset Cap & Exposure Policy",
    authorization: "Read-only (none)",
    securitySensitive: false,
    summary: "Returns the optional configured per-seller open escrow exposure ceiling for an asset.",
    links: ["[Handoff: Upto Session Functions](../../docs/backend-integration-handoff.md#upto-session-functions)"],
  },
  get_seller_open_sessions: {
    category: "Asset Cap & Exposure Policy",
    authorization: "Read-only (none)",
    securitySensitive: false,
    summary: "Returns the number of currently open sessions for a seller.",
    links: ["[Handoff: Upto Session Functions](../../docs/backend-integration-handoff.md#upto-session-functions)"],
  },
  get_session: {
    category: "Session Lifecycle",
    authorization: "Read-only (none)",
    securitySensitive: false,
    summary: "Returns the stored `Session` record for `session_id` or fails with `SessionNotFound`.",
    links: [
      "[Handoff: Upto Session Functions](../../docs/backend-integration-handoff.md#upto-session-functions)",
      "[Storage Lifecycle](../../docs/storage-lifecycle.md)",
    ],
  },
  get_session_batch: {
    category: "Session Lifecycle",
    authorization: "Read-only (none)",
    securitySensitive: false,
    summary: "Reads 1 to 8 session IDs in request order, returning `Found(Session)` or `NotFound` per item.",
    links: ["[Handoff: Upto Session Functions](../../docs/backend-integration-handoff.md#upto-session-functions)"],
  },
  get_session_status: {
    category: "Session Lifecycle",
    authorization: "Read-only (none)",
    securitySensitive: false,
    summary: "Returns lightweight `SessionStatusResponse` (`exists`, `status`, `expires_at_ledger`).",
    links: ["[Handoff: Upto Session Functions](../../docs/backend-integration-handoff.md#upto-session-functions)"],
  },
  get_solvency: {
    category: "Solvency & Liability Accounting",
    authorization: "Read-only (none)",
    securitySensitive: false,
    summary: "Returns ordered `AssetSolvency` snapshots for 1 to 16 assets.",
    links: ["[Handoff: Upto Session Functions](../../docs/backend-integration-handoff.md#upto-session-functions)"],
  },
  initialize: {
    category: "Configuration & Version Discovery",
    authorization: "Admin (`admin.require_auth()`)",
    securitySensitive: true,
    summary: "One-time deployment initialization with 1 to 16 unique SEP-41 asset policies.",
    links: [
      "[Handoff: Initialization](../../docs/backend-integration-handoff.md#upto-session-functions)",
      "[Security Checklist](../../docs/security-checklist.md)",
      "[Deployment Migration](../../docs/deployment-migration.md)",
    ],
  },
  interface_version: {
    category: "Configuration & Version Discovery",
    authorization: "Read-only (none)",
    securitySensitive: false,
    summary: "Returns the contract interface version (`3`).",
    links: ["[Handoff: Generated Interfaces](../../docs/backend-integration-handoff.md#generated-interfaces)"],
  },
  max_session_duration_ledgers: {
    category: "Configuration & Version Discovery",
    authorization: "Read-only (none)",
    securitySensitive: false,
    summary: "Returns the maximum allowed session lifetime in ledgers (`518400`).",
    links: ["[Storage Lifecycle](../../docs/storage-lifecycle.md)"],
  },
  pause_creation: {
    category: "Operational State & Cutover",
    authorization: "Active admin (`admin.require_auth()`)",
    securitySensitive: true,
    summary: "Transitions operational state to `Paused`, rejecting new `create_session` calls while keeping settlements, cancellations, and recoveries active.",
    links: [
      "[Handoff: Replacement Deployments](../../docs/backend-integration-handoff.md#replacement-deployments-and-session-routes)",
      "[Deployment Migration](../../docs/deployment-migration.md)",
      "[Security Checklist](../../docs/security-checklist.md)",
    ],
  },
  preview_settle: {
    category: "Session Lifecycle",
    authorization: "Read-only (none)",
    securitySensitive: false,
    summary: "Simulates settlement eligibility, seller payout, buyer refund, and rejection reason without mutating state.",
    links: ["[Handoff: Upto Session Functions](../../docs/backend-integration-handoff.md#upto-session-functions)"],
  },
  propose_admin: {
    category: "Governance & Admin Rotation",
    authorization: "Active admin (`admin.require_auth()`)",
    securitySensitive: true,
    summary: "Proposes a new administrator with an expiry window bounded to 1..=17,280 ledgers.",
    links: [
      "[Handoff: Admin Rotation](../../docs/backend-integration-handoff.md#upto-session-functions)",
      "[Security Checklist](../../docs/security-checklist.md)",
    ],
  },
  propose_asset_cap_increase: {
    category: "Asset Cap & Exposure Policy",
    authorization: "Active admin (`admin.require_auth()`)",
    securitySensitive: true,
    summary: "Proposes a time-locked per-asset session cap increase with an activation delay between 100 and 17,280 ledgers.",
    links: [
      "[Handoff: Asset Cap Policy](../../docs/backend-integration-handoff.md#upto-session-functions)",
      "[Security Checklist](../../docs/security-checklist.md)",
    ],
  },
  recover_expired: {
    category: "Session Lifecycle",
    authorization: "Permissionless (at or after `expires_at_ledger`)",
    securitySensitive: true,
    summary: "Recovers an open session at or after `expires_at_ledger` and refunds the full escrowed amount strictly to the stored buyer.",
    links: [
      "[Handoff: Session Exits](../../docs/backend-integration-handoff.md#upto-session-functions)",
      "[Security Checklist](../../docs/security-checklist.md)",
      "[Storage Lifecycle](../../docs/storage-lifecycle.md)",
    ],
  },
  recover_expired_batch: {
    category: "Session Lifecycle",
    authorization: "Permissionless (1 to 8 session IDs)",
    securitySensitive: true,
    summary: "Recovers up to 8 session IDs in request order, returning per-item `BatchRecoveryResult` without aborting on ineligible items.",
    links: [
      "[Handoff: Batch Recovery](../../docs/backend-integration-handoff.md#upto-session-functions)",
      "[Security Checklist](../../docs/security-checklist.md)",
      "[Storage Lifecycle](../../docs/storage-lifecycle.md)",
    ],
  },
  recover_surplus: {
    category: "Solvency & Liability Accounting",
    authorization: "Active admin (`admin.require_auth()`)",
    securitySensitive: true,
    summary: "Transfers unencumbered token surplus (`balance - liability`) above open-session escrow liability to `recipient`.",
    links: [
      "[Handoff: Solvency & Liability](../../docs/backend-integration-handoff.md#upto-session-functions)",
      "[Security Checklist](../../docs/security-checklist.md)",
    ],
  },
  reduce_session_cap: {
    category: "Session Lifecycle",
    authorization: "Buyer (`session.buyer.require_auth()`)",
    securitySensitive: true,
    summary: "Reduces an open, unexpired session's cap and immediately refunds the difference to the buyer.",
    links: [
      "[Handoff: Session Lifecycle](../../docs/backend-integration-handoff.md#upto-session-functions)",
      "[Security Checklist](../../docs/security-checklist.md)",
    ],
  },
  reject: {
    category: "Session Lifecycle",
    authorization: "Seller (`session.seller.require_auth()`)",
    securitySensitive: true,
    summary: "Seller-authorized rejection of an open, unexpired session with full refund to the buyer.",
    links: [
      "[Handoff: Session Exits](../../docs/backend-integration-handoff.md#upto-session-functions)",
      "[Security Checklist](../../docs/security-checklist.md)",
    ],
  },
  remove_asset: {
    category: "Asset Lifecycle",
    authorization: "Active admin (`admin.require_auth()`)",
    securitySensitive: true,
    summary: "Removes a deprecated asset once its open escrow liability is zero, recording a 32-byte reason commitment.",
    links: [
      "[Handoff: Asset Lifecycle](../../docs/backend-integration-handoff.md#v2-to-v3-compatibility)",
      "[Security Checklist](../../docs/security-checklist.md)",
    ],
  },
  resume_creation: {
    category: "Operational State & Cutover",
    authorization: "Active admin (`admin.require_auth()`)",
    securitySensitive: true,
    summary: "Transitions operational state from `Paused` back to `Active`.",
    links: [
      "[Handoff: Replacement Deployments](../../docs/backend-integration-handoff.md#replacement-deployments-and-session-routes)",
      "[Deployment Migration](../../docs/deployment-migration.md)",
      "[Security Checklist](../../docs/security-checklist.md)",
    ],
  },
  set_asset_exposure_ceiling: {
    category: "Asset Cap & Exposure Policy",
    authorization: "Active admin (`admin.require_auth()`)",
    securitySensitive: true,
    summary: "Updates the aggregate open escrow liability ceiling for an asset.",
    links: [
      "[Handoff: Exposure Ceilings](../../docs/backend-integration-handoff.md#upto-session-functions)",
      "[Security Checklist](../../docs/security-checklist.md)",
    ],
  },
  set_asset_max_session_amount: {
    category: "Asset Cap & Exposure Policy",
    authorization: "Active admin (`admin.require_auth()`)",
    securitySensitive: true,
    summary: "Decreases or maintains an asset's per-session cap immediately; cap increases require `propose_asset_cap_increase`.",
    links: [
      "[Handoff: Asset Cap Policy](../../docs/backend-integration-handoff.md#upto-session-functions)",
      "[Security Checklist](../../docs/security-checklist.md)",
    ],
  },
  set_buyer_exposure_ceiling: {
    category: "Asset Cap & Exposure Policy",
    authorization: "Active admin (`admin.require_auth()`)",
    securitySensitive: true,
    summary: "Updates the per-buyer open escrow exposure ceiling for an asset.",
    links: [
      "[Handoff: Exposure Ceilings](../../docs/backend-integration-handoff.md#upto-session-functions)",
      "[Security Checklist](../../docs/security-checklist.md)",
    ],
  },
  set_max_buyer_open_sessions: {
    category: "Asset Cap & Exposure Policy",
    authorization: "Active admin (`admin.require_auth()`)",
    securitySensitive: true,
    summary: "Configures the maximum concurrent open sessions permitted per buyer.",
    links: [
      "[Handoff: Exposure Ceilings](../../docs/backend-integration-handoff.md#upto-session-functions)",
      "[Security Checklist](../../docs/security-checklist.md)",
    ],
  },
  set_max_seller_open_sessions: {
    category: "Asset Cap & Exposure Policy",
    authorization: "Active admin (`admin.require_auth()`)",
    securitySensitive: true,
    summary: "Configures the maximum concurrent open sessions permitted per seller.",
    links: [
      "[Handoff: Exposure Ceilings](../../docs/backend-integration-handoff.md#upto-session-functions)",
      "[Security Checklist](../../docs/security-checklist.md)",
    ],
  },
  set_seller_exposure_ceiling: {
    category: "Asset Cap & Exposure Policy",
    authorization: "Active admin (`admin.require_auth()`)",
    securitySensitive: true,
    summary: "Updates the per-seller open escrow exposure ceiling for an asset.",
    links: [
      "[Handoff: Exposure Ceilings](../../docs/backend-integration-handoff.md#upto-session-functions)",
      "[Security Checklist](../../docs/security-checklist.md)",
    ],
  },
  settle: {
    category: "Session Lifecycle",
    authorization: "Seller (`session.seller.require_auth()`)",
    securitySensitive: true,
    summary: "Finalizes an open, unexpired session, paying `actual_amount` to the seller and refunding `escrowed_amount - actual_amount` to the buyer.",
    links: [
      "[Handoff: Settlement & Usage Commitments](../../docs/backend-integration-handoff.md#upto-session-functions)",
      "[Security Checklist](../../docs/security-checklist.md)",
      "[Storage Lifecycle](../../docs/storage-lifecycle.md)",
    ],
  },
});

export function formatSpecType(typeDef) {
  if (typeof typeDef === "string") {
    switch (typeDef) {
      case "address":
        return "string (Address)";
      case "bool":
        return "boolean";
      case "u32":
        return "u32 (number)";
      case "u64":
        return "u64 (bigint)";
      case "i128":
        return "i128 (bigint)";
      case "void":
        return "void";
      case "bytes":
        return "Buffer";
      case "string":
        return "string";
      case "symbol":
        return "string";
      default:
        return typeDef;
    }
  }
  if (!typeDef || typeof typeDef !== "object") {
    return "unknown";
  }
  if (typeDef.bytes_n) {
    return `BytesN<${typeDef.bytes_n.n}> (Buffer)`;
  }
  if (typeDef.udt) {
    return typeDef.udt.name;
  }
  if (typeDef.option) {
    return `Option<${formatSpecType(typeDef.option.value_type)}>`;
  }
  if (typeDef.vec) {
    return `Array<${formatSpecType(typeDef.vec.element_type)}>`;
  }
  if (typeDef.result) {
    const ok = formatSpecType(typeDef.result.ok_type);
    const err = formatSpecType(typeDef.result.error_type);
    return `Result<${ok}, ${err}>`;
  }
  if (typeDef.tuple) {
    const elements = (typeDef.tuple.value_types ?? []).map(formatSpecType);
    return `[${elements.join(", ")}]`;
  }
  return JSON.stringify(typeDef);
}

export function loadBindingApiInputs(repoRoot) {
  const specText = readFileSync(join(repoRoot, "artifacts", "spec", "upto-session.json"), "utf8").replace(/\r\n/g, "\n");
  const spec = JSON.parse(specText);
  const specSha256 = createHash("sha256").update(specText).digest("hex");
  const v3Fixture = JSON.parse(
    readFileSync(join(repoRoot, "artifacts", "interface", "upto-session-v3.json"), "utf8"),
  );
  const v2Fixture = JSON.parse(
    readFileSync(join(repoRoot, "artifacts", "interface", "upto-session-v2.json"), "utf8"),
  );
  const evidenceReadme = readFileSync(
    join(repoRoot, "scripts", "templates", "README.transactionEvidence.md"),
    "utf8",
  ).replace(/\r\n/g, "\n");

  return {
    spec,
    specSha256,
    v3Fixture,
    v2Fixture,
    evidenceReadme,
  };
}

export function generateBindingApiReference({
  spec,
  specSha256,
  v3Fixture,
  v2Fixture,
  evidenceReadme,
}) {
  if (!Array.isArray(spec) || spec.length === 0) {
    throw new Error("Canonical spec must be a non-empty array.");
  }
  if (!v3Fixture || v3Fixture.interfaceVersion !== 3) {
    throw new Error("v3 interface fixture must have interfaceVersion 3.");
  }
  if (!v2Fixture || v2Fixture.interfaceVersion !== 2) {
    throw new Error("v2 interface fixture must have interfaceVersion 2.");
  }
  if (specSha256 && v3Fixture.sourceSpecSha256 !== specSha256) {
    throw new Error(
      `v3 interface fixture sourceSpecSha256 (${v3Fixture.sourceSpecSha256}) does not match frozen spec SHA-256 (${specSha256}).`,
    );
  }

  const functions = spec
    .filter((entry) => entry.function_v0 !== undefined)
    .map((entry) => entry.function_v0)
    .sort((a, b) => compareAscii(a.name, b.name));

  const specMethodNames = functions.map((fn) => fn.name);
  const v3MethodNames = [...v3Fixture.methods].sort(compareAscii);
  if (specMethodNames.join(",") !== v3MethodNames.join(",")) {
    throw new Error("Public methods in frozen spec do not match v3 interface fixture.");
  }

  for (const methodName of specMethodNames) {
    const meta = METHOD_METADATA[methodName];
    if (!meta) {
      throw new Error(`Missing METHOD_METADATA entry for public method "${methodName}".`);
    }
    if (meta.securitySensitive && (!Array.isArray(meta.links) || meta.links.length === 0)) {
      throw new Error(`Security-sensitive method "${methodName}" must link to authorization and lifecycle notes.`);
    }
  }
  for (const configuredName of Object.keys(METHOD_METADATA)) {
    if (!specMethodNames.includes(configuredName)) {
      throw new Error(`METHOD_METADATA contains unknown method "${configuredName}" not present in frozen spec.`);
    }
  }

  const structs = spec
    .filter((entry) => entry.udt_struct_v0 !== undefined)
    .map((entry) => entry.udt_struct_v0)
    .sort((a, b) => compareAscii(a.name, b.name));

  const enums = spec
    .filter((entry) => entry.udt_enum_v0 !== undefined || entry.udt_union_v0 !== undefined)
    .map((entry) =>
      entry.udt_enum_v0
        ? { kind: "enum", ...entry.udt_enum_v0 }
        : { kind: "union", ...entry.udt_union_v0 },
    )
    .sort((a, b) => compareAscii(a.name, b.name));

  const errorEnum = spec.find((entry) => entry.udt_error_enum_v0?.name === "ContractError")?.udt_error_enum_v0;
  if (!errorEnum) {
    throw new Error("Canonical spec is missing ContractError.");
  }
  const specErrors = [...errorEnum.cases].sort((a, b) => a.value - b.value);
  const v3Errors = [...v3Fixture.errors].sort((a, b) => a.value - b.value);
  if (
    specErrors.length !== v3Errors.length ||
    specErrors.some((err, idx) => err.name !== v3Errors[idx].name || err.value !== v3Errors[idx].value)
  ) {
    throw new Error("ContractError cases in frozen spec do not match v3 interface fixture.");
  }

  const specEvents = spec
    .filter((entry) => entry.event_v0 !== undefined)
    .map((entry) => entry.event_v0)
    .sort((a, b) => compareAscii(a.name, b.name));
  const v3Events = [...v3Fixture.events].sort((a, b) => compareAscii(a.name, b.name));
  if (
    specEvents.length !== v3Events.length ||
    specEvents.some((ev, idx) => ev.name !== v3Events[idx].name)
  ) {
    throw new Error("Events in frozen spec do not match v3 interface fixture.");
  }

  const v2MethodSet = new Set(v2Fixture.methods);
  const v2ErrorMap = new Map(v2Fixture.errors.map((e) => [e.value, e.name]));
  const v2EventSet = new Set(v2Fixture.events.map((e) => e.name));

  const lines = [];
  lines.push("# `upto-session` TypeScript Binding & API Reference");
  lines.push("");
  lines.push(
    "Deterministic TypeScript client and API reference for the LumenBazaar `upto-session` Soroban smart contract, generated from the frozen specification (`artifacts/spec/upto-session.json`) and compatibility fixtures (`artifacts/interface/upto-session-v3.json`, `artifacts/interface/upto-session-v2.json`).",
  );
  lines.push("");
  lines.push("## Package & Interface Metadata");
  lines.push("");
  lines.push("| Property | Value |");
  lines.push("| --- | --- |");
  lines.push("| Package | `upto-session` (`3.0.0`) |");
  lines.push(`| Contract Version | \`${v3Fixture.contractVersion}\` |`);
  lines.push(`| Interface Version | \`${v3Fixture.interfaceVersion}\` (\`interface_version() === 3\`) |`);
  lines.push(`| Frozen Spec SHA-256 | \`${v3Fixture.sourceSpecSha256}\` |`);
  lines.push("| Supported Networks | Stellar `testnet` (`Test SDF Network ; September 2015`) and local `standalone` (`Standalone Network ; February 2017`) only |");
  lines.push("| Unsupported Networks | Stellar `pubnet` and `futurenet` are unsupported and fail closed |");
  lines.push("| Test Token Posture | `LBT` (`test-token`) is a synthetic local/testnet utility token only and is never USDC |");
  lines.push("");
  lines.push("## Security, Lifecycle & Integration Guidance");
  lines.push("");
  lines.push("- [Backend Integration Handoff](../../docs/backend-integration-handoff.md): End-to-end session routing, domain-separated hashing, and error handling.");
  lines.push("- [Security Checklist](../../docs/security-checklist.md): Authorization boundaries, token invariant verification, and admin controls.");
  lines.push("- [Storage Lifecycle](../../docs/storage-lifecycle.md): Instance vs. persistent storage TTL thresholds, extension rules, and archival recovery constraints.");
  lines.push("- [Deployment Migration](../../docs/deployment-migration.md): Replacement deployment cutover, rollback routing, and `(network, contract_id, session_id)` persistence.");
  lines.push("- [Replacement Deployment Rehearsal](../../docs/replacement-deployment-rehearsal.md): Rehearsal evidence and cross-version behavioral trace verification.");
  lines.push("- [Backend Encoding Vectors](../../artifacts/backend-handoff/README.md): Versioned cross-repository XDR, hash, and event decoding vectors.");
  lines.push("");
  lines.push("## Public Methods Reference");
  lines.push("");
  lines.push(
    "Every contract method on `Client` returns a simulated `AssembledTransaction<T>` unless invoked through the transaction evidence helpers below. Security-sensitive methods link directly to authorization and lifecycle documentation.",
  );
  lines.push("");
  lines.push("| Method | Inputs | Output | Authorization | Compatibility | Summary & Guidance |");
  lines.push("| --- | --- | --- | --- | --- | --- |");

  for (const fn of functions) {
    const meta = METHOD_METADATA[fn.name];
    const inputs =
      fn.inputs.length === 0
        ? "_none_"
        : fn.inputs.map((inp) => `\`${inp.name}: ${formatSpecType(inp.type)}\``).join("<br>");
    const output =
      fn.outputs.length === 0
        ? "`void`"
        : fn.outputs.map((out) => `\`${formatSpecType(out)}\``).join(", ");
    const compat = v2MethodSet.has(fn.name)
      ? fn.name === "initialize" || fn.name === "create_session"
        ? "v2 + v3 (v3 payload)"
        : "v2 + v3"
      : "v3 addition";
    const securityBadge = meta.securitySensitive ? "**[Security-Sensitive]** " : "";
    const linksText = meta.links.join(" · ");
    lines.push(
      `| \`${fn.name}\` | ${inputs} | ${output} | ${meta.authorization} | ${compat} | ${securityBadge}${meta.summary} ${linksText} |`,
    );
  }

  lines.push("");
  lines.push("## Public Types Reference");
  lines.push("");
  lines.push("### Struct Types");
  lines.push("");
  lines.push("| Type | Fields | Description |");
  lines.push("| --- | --- | --- |");
  for (const st of structs) {
    const fields = st.fields
      .map((field) => `\`${field.name}: ${formatSpecType(field.type)}\``)
      .join("<br>");
    const doc = sanitizeSingleLine(st.doc) || "Contract struct type exported in generated bindings.";
    lines.push(`| \`${st.name}\` | ${fields} | ${doc} |`);
  }

  lines.push("");
  lines.push("### Enum & Union Types");
  lines.push("");
  lines.push("| Type | Variants | Description |");
  lines.push("| --- | --- | --- |");
  for (const en of enums) {
    const variants = (en.cases ?? [])
      .map((c) => {
        if (c.type !== undefined) {
          return `\`${c.name}(${formatSpecType(c.type)})\``;
        }
        if (Array.isArray(c.types) && c.types.length > 0) {
          return `\`${c.name}(${c.types.map(formatSpecType).join(", ")})\``;
        }
        if (typeof c.value === "number") {
          return `\`${c.name} = ${c.value}\``;
        }
        return `\`${c.name}\``;
      })
      .join("<br>");
    const doc =
      en.name === "DataKey"
        ? "Contract storage key space (instance and persistent storage keys)."
        : sanitizeSingleLine(en.doc) || "Contract enum/union type exported in generated bindings.";
    lines.push(`| \`${en.name}\` | ${variants} | ${doc} |`);
  }

  lines.push("");
  lines.push("## Contract Errors Reference (`ContractError`)");
  lines.push("");
  lines.push(
    "All contract failures use stable numeric `u32` error codes (`1..=60`). Use `decodeContractError(error)`, `isContractError(error, name)`, `CONTRACT_ERROR_CODES`, and `CONTRACT_ERROR_NAMES` to classify contract, host, and transport errors deterministically. See [Stable Errors](../../docs/backend-integration-handoff.md#stable-errors).",
  );
  lines.push("");
  lines.push("| Code | Error Name | Compatibility | Category |");
  lines.push("| ---: | --- | --- | --- |");
  for (const err of specErrors) {
    const compat = v2ErrorMap.get(err.value) === err.name ? "v2 + v3 (retained)" : "v3 addition";
    const category = classifyErrorCategory(err.value);
    lines.push(`| ${err.value} | \`${err.name}\` | ${compat} | ${category} |`);
  }

  lines.push("");
  lines.push("## Events Reference");
  lines.push("");
  lines.push(
    "Every event publishes one prefix topic (`Symbol`) and one bounded 32-byte indexed topic (`session_id` or `Address`), plus a data map containing `event_version: u32`. See [Indexed Event Topics](../../docs/backend-integration-handoff.md#indexed-event-topics).",
  );
  lines.push("");
  lines.push("| Event | Prefix Topic | Indexed Topic | Data Fields | Compatibility |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const ev of v3Events) {
    const prefix = ev.prefixTopics.map((t) => `\`${t}\``).join(", ");
    const topicFields = ev.fields
      .filter((f) => f.location === "topic")
      .map((f) => `\`${f.name}: ${formatSpecType(f.type)}\``)
      .join("<br>");
    const dataFields = ev.fields
      .filter((f) => f.location === "data")
      .map((f) => `\`${f.name}: ${formatSpecType(f.type)}\``)
      .join("<br>");
    const compat = v2EventSet.has(ev.name) ? "v2 + v3 (`event_version: 2`)" : "v3 addition (`event_version: 1` or `3`)";
    lines.push(`| \`${ev.name}\` | ${prefix} | ${topicFields} | ${dataFields} | ${compat} |`);
  }

  lines.push("");
  lines.push("## Handwritten Domain, Receipt & Error Helpers");
  lines.push("");
  lines.push("| Export | Source Module | Purpose |");
  lines.push("| --- | --- | --- |");
  lines.push("| `deriveSessionId(input)` | `src/sessionId.ts` | Derives the v3 domain-separated `session_id` (64-char lowercase hex) from `SessionIdInputV3`. |");
  lines.push("| `deriveSessionIdPreimage(input)` | `src/sessionId.ts` | Returns the raw Soroban `ScVal` XDR preimage `Buffer` for `(domain_xdr, payload_xdr)`. |");
  lines.push("| `validateSessionIdInput(input)` | `src/sessionId.ts` | Validates v3 session ID derivation inputs and fails closed on v2 or malformed arguments. |");
  lines.push("| `canonicalizeUsageReceipt(receipt)` | `src/usageReceipt.ts` | Serializes a v1 usage receipt into canonical compact UTF-8 JSON. |");
  lines.push("| `hashUsageReceipt(receipt)` | `src/usageReceipt.ts` | Computes the 32-byte SHA-256 `measurement_hash` hex for a canonical v1 usage receipt. |");
  lines.push("| `parseCanonicalUsageReceipt(json)` | `src/usageReceipt.ts` | Validates and parses a canonical v1 usage receipt JSON string. |");
  lines.push("| `decodeContractError(error)` | `src/contractErrors.ts` | Decodes thrown, simulated, or RPC failures into `contract`, `unknown_contract`, `malformed_contract`, `host`, or `other`. |");
  lines.push("| `isContractError(error, name)` | `src/contractErrors.ts` | Type-safe predicate matching a known `ContractErrorName`. |");
  lines.push("");
  lines.push(evidenceReadme.trimEnd());
  lines.push("");

  return lines.join("\n");
}

function classifyErrorCategory(code) {
  if (code <= 22) {
    return "Core Session, Validation & Liability (v2 baseline)";
  }
  if (code >= 23 && code <= 35) {
    return "Asset Policy, Admin Rotation, SEP-41 Probe & Batch Bounds";
  }
  if (code === 36 || code === 37) {
    return "Operational State (`Paused` / `Active`)";
  }
  if (code >= 38 && code <= 42) {
    return "Time-Locked Asset Cap Increases";
  }
  if (code === 43) {
    return "Commitment Scheme Versioning";
  }
  if (code >= 44 && code <= 58) {
    return "Exposure Ceilings, Open Session Limits & Lifecycle Guards";
  }
  return "Sequence Exhaustion & Idempotency Protection";
}

function sanitizeSingleLine(text) {
  if (!text || typeof text !== "string") {
    return "";
  }
  return text.replace(/\s+/g, " ").trim();
}

function compareAscii(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
