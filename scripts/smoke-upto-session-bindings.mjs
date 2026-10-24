import { readFile } from "node:fs/promises";
import { deepStrictEqual } from "node:assert";

const bindings = await import("../bindings/upto-session/dist/index.js");
const distSource = await readFile(
  new URL("../bindings/upto-session/dist/index.js", import.meta.url),
  "utf8",
);
const packageJson = JSON.parse(
  await readFile(new URL("../bindings/upto-session/package.json", import.meta.url), "utf8"),
);

const requiredMethods = [
  "interface_version",
  "initialize",
  "get_asset_max_session_amount",
  "set_asset_max_session_amount",
  "get_admin",
  "get_admin_rotation",
  "propose_admin",
  "accept_admin",
  "cancel_admin_rotation",
  "get_configuration",
  "create_session",
  "deprecate_asset",
  "remove_asset",
  "get_session",
  "get_session_batch",
  "get_escrow_liability",
  "get_solvency",
  "settle",
  "preview_settle",
  "cancel",
  "reject",
  "recover_expired",
  "get_recoverability",
  "recover_expired_batch",
  "extend_ttl",
  "pause_creation",
  "resume_creation",
  "set_asset_exposure_ceiling",
  "get_asset_exposure_ceiling",
  "set_buyer_exposure_ceiling",
  "get_buyer_exposure_ceiling",
  "get_buyer_exposure",
  "get_asset_solvency",
];

if (typeof bindings.Client !== "function") {
  throw new Error("Expected generated Client export");
}

if (bindings.ContractError?.[5]?.message !== "SessionNotFound") {
  throw new Error("Expected stable SessionNotFound error mapping");
}
if (bindings.ContractError?.[22]?.message !== "SessionNotExpired") {
  throw new Error("Expected stable SessionNotExpired error mapping");
}
if (bindings.ContractError?.[24]?.message !== "AssetCapNotConfigured") {
  throw new Error("Expected stable asset cap error mapping");
}
if (bindings.ContractError?.[29]?.message !== "AdminRotationExpired") {
  throw new Error("Expected complete governance error mapping");
}
if (bindings.ContractError?.[31]?.message !== "InvalidBatchSize") {
  throw new Error("Expected stable InvalidBatchSize error mapping");
}
if (bindings.ContractError?.[32]?.message !== "InvalidAssetInterface") {
  throw new Error("Expected complete v3 ContractError mapping");
}
if (bindings.ContractError?.[35]?.message !== "AssetLiabilityOutstanding") {
  throw new Error("Expected complete asset lifecycle error mapping");
}
if (bindings.ContractError?.[36]?.message !== "SessionRejected") {
  throw new Error("Expected SessionRejected error mapping");
if (bindings.ContractError?.[37]?.message !== "OperationalStateUnchanged") {
  throw new Error("Expected complete operational state error mapping");
}
if (packageJson.version !== "3.0.0") {
  throw new Error("Expected generated binding package version 3.0.0");
}
if (typeof bindings.deriveSessionId !== "function") {
  throw new Error("Expected deriveSessionId export");
}
if (typeof bindings.deriveSessionIdPreimage !== "function") {
  throw new Error("Expected deriveSessionIdPreimage export");
}

for (const method of requiredMethods) {
  if (!distSource.includes(method)) {
    throw new Error(`Expected generated binding to include ${method}`);
  }
}

const dtsSource = await readFile(
  new URL("../bindings/upto-session/dist/index.d.ts", import.meta.url),
  "utf8",
);
for (const typeSymbol of [
  "export interface BatchSessionResult",
  "export type BatchSessionStatus",
  "session_ids: Array<Buffer>;",
  "Result<Array<BatchSessionResult>>",
]) {
  if (!dtsSource.includes(typeSymbol)) {
    throw new Error(`Expected generated TypeScript declarations to include ${typeSymbol}`);
  }
}

// Exercise the generated query schema without an RPC request. Include an i128
// above Number.MAX_SAFE_INTEGER and duplicate IDs to catch lossy client codecs.
const contractId = bindings.StrKey.encodeContract(Buffer.alloc(32));
const client = new bindings.Client({
  contractId,
  networkPassphrase: bindings.Networks.TESTNET,
  rpcUrl: "http://127.0.0.1:8000",
  allowHttp: true,
});
const foundId = new Uint8Array(32).fill(1);
const missingId = new Uint8Array(32).fill(2);
const sessionIds = [foundId, missingId, foundId];
const querySpec = client.spec.getFunc("get_session_batch");
const [encodedIds] = client.spec.funcArgsToScVals("get_session_batch", {
  session_ids: sessionIds,
});
deepStrictEqual(client.spec.scValToNative(encodedIds, querySpec.inputs[0].type), sessionIds);

const session = {
  id: foundId,
  asset: contractId,
  buyer: bindings.StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 3)),
  seller: bindings.StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 4)),
  creation_ledger: 100,
  escrowed_amount: 9007199254740993n,
  max_amount: 9007199254740993n,
  expires_at_ledger: 200,
  finalized_ledger: null,
  resource_hash: new Uint8Array(32).fill(5),
  resource_scheme_version: 1,
  settled_amount: 0n,
  status: { tag: "Open" },
  usage_hash: null,
  usage_scheme_version: null,
};
const results = [
  { session_id: foundId, status: { tag: "Found", values: [session] } },
  { session_id: missingId, status: { tag: "NotFound" } },
  { session_id: foundId, status: { tag: "Found", values: [session] } },
];
const encodedResults = client.spec.nativeToScVal(results, querySpec.outputs[0].value.okType);
deepStrictEqual(client.spec.funcResToNative("get_session_batch", encodedResults).unwrap(), results);

console.log("upto-session TypeScript binding smoke test passed");
