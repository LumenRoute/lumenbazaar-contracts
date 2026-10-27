// Unit tests for the transaction evidence helpers shipped in the TypeScript
// binding (scripts/templates/transactionEvidence.ts). Offline: RPC, signer and
// clock are injected. Run after building the binding:
//   npm --prefix bindings/upto-session run build
//   node --test scripts/test-transaction-evidence.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  failedPoll,
  fakeClient,
  fakeTime,
  mockRpc,
  recordingSigner,
  successPoll,
  syntheticTransaction,
  transactionHashHex,
} from "./lib/transaction-evidence-fixtures.mjs";

const sdk = await import("../bindings/upto-session/dist/index.js");
const {
  EvidenceError,
  Networks,
  assertConfirmedEvidence,
  cancelWithEvidence,
  createSessionWithEvidence,
  extendTtlWithEvidence,
  settleWithEvidence,
  xdr,
} = sdk;
const TESTNET = Networks.TESTNET;
const sessionIdBytes = Buffer.alloc(32, 0x5e);

const flows = [
  ["create_session", createSessionWithEvidence, { buyer: "G", seller: "G", asset: "C", max_amount: 1n, expires_at_ledger: 2, resource_hash: Buffer.alloc(32, 9) }, xdr.ScVal.scvBytes(sessionIdBytes), "scvBytes"],
  ["settle", settleWithEvidence, { session_id: sessionIdBytes, actual_amount: 1n, usage_hash: Buffer.alloc(32, 14) }, xdr.ScVal.scvVoid(), "scvVoid"],
  ["cancel", cancelWithEvidence, { session_id: sessionIdBytes }, xdr.ScVal.scvVoid(), "scvVoid"],
  ["extend_ttl", extendTtlWithEvidence, { session_id: sessionIdBytes }, xdr.ScVal.scvVoid(), "scvVoid"],
];

function options(rpc, overrides = {}) {
  return { networkPassphrase: TESTNET, rpc, signer: recordingSigner(), ...fakeTime(), ...overrides };
}

async function rejects(promise, code, pattern) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof EvidenceError, `expected EvidenceError, got ${error}`);
    assert.equal(error.code, code);
    if (pattern) {
      assert.match(error.message, pattern);
    }
    return true;
  });
}

for (const [method, flow, args, returnValue, decodedType] of flows) {
  test(`${method} returns confirmed evidence taken from RPC`, async () => {
    const client = fakeClient(sdk, TESTNET);
    const rpc = mockRpc({ polls: [{ status: "NOT_FOUND" }, successPoll(sdk, returnValue)] });
    const signer = recordingSigner();
    const evidence = await flow(client, args, options(rpc, { signer }));

    assertConfirmedEvidence(evidence);
    assert.equal(evidence.status, "confirmed");
    assert.equal(evidence.method, method);
    assert.equal(evidence.network, "testnet");
    assert.equal(evidence.transactionHash, transactionHashHex(rpc.state.sent[0]));
    assert.equal(evidence.ledger, 4_541_400);
    assert.equal(evidence.createdAt, 1_790_000_010);
    assert.deepEqual(evidence.result, { decodedType });
    assert.deepEqual(client.calls, [{ name: method, args }]);
    assert.equal(rpc.state.polled.length, 2);
    // The signer is the only party that signs; it receives the envelope and
    // network passphrase and nothing else.
    assert.equal(signer.calls.length, 1);
    assert.equal(typeof signer.calls[0][0], "string");
    assert.deepEqual(signer.calls[0][1], { networkPassphrase: TESTNET });
  });
}

test("an on-ledger failure is failed evidence, not an exception", async () => {
  const rpc = mockRpc({ polls: [failedPoll(sdk)] });
  const evidence = await settleWithEvidence(fakeClient(sdk, TESTNET), flows[1][2], options(rpc));
  assert.equal(evidence.status, "failed");
  assert.equal(evidence.stage, "ledger");
  assert.equal(evidence.ledger, 4_541_401);
  assert.equal(evidence.resultCode, "txFailed");
  assert.match(evidence.resultXdr, /^[A-Za-z0-9+/]+=*$/);
  assert.throws(() => assertConfirmedEvidence(evidence), /not confirmed/);
});

test("an RPC submission rejection is failed evidence without a ledger", async () => {
  const errorResult = failedPoll(sdk).resultXdr;
  const rpc = mockRpc({ send: { status: "ERROR", errorResult } });
  const evidence = await cancelWithEvidence(fakeClient(sdk, TESTNET), flows[2][2], options(rpc));
  assert.equal(evidence.status, "failed");
  assert.equal(evidence.stage, "submission");
  assert.equal(evidence.ledger, undefined);
  assert.equal(evidence.resultCode, "txFailed");
  assert.equal(rpc.state.polled.length, 0);
});

test("an unconfirmed transaction is pending with the real hash and bounded polling", async () => {
  const rpc = mockRpc({ polls: [{ status: "NOT_FOUND" }] });
  const evidence = await extendTtlWithEvidence(
    fakeClient(sdk, TESTNET),
    flows[3][2],
    options(rpc, { timeoutMs: 5_000, pollIntervalMs: 1_000 }),
  );
  assert.equal(evidence.status, "pending");
  assert.equal(evidence.transactionHash, transactionHashHex(rpc.state.sent[0]));
  assert.equal(evidence.attempts, 6);
  assert.equal(evidence.elapsedMs, 5_000);
  assert.equal(evidence.latestLedger, 901);
  assert.equal(rpc.state.polled.length, 6);
  assert.throws(() => assertConfirmedEvidence(evidence), /not confirmed/);
});

test("DUPLICATE submissions are confirmed by polling the same hash", async () => {
  const rpc = mockRpc({ send: { status: "DUPLICATE" }, polls: [successPoll(sdk)] });
  const evidence = await cancelWithEvidence(fakeClient(sdk, TESTNET), flows[2][2], options(rpc));
  assert.equal(evidence.status, "confirmed");
});

test("a transport error on send is an RPC error with only a locally computed hash", async () => {
  const rpc = mockRpc({ send: new Error("socket hang up") });
  await assert.rejects(cancelWithEvidence(fakeClient(sdk, TESTNET), flows[2][2], options(rpc)), (error) => {
    assert.equal(error.code, "rpc_error");
    assert.equal(error.transactionHash, undefined);
    assert.match(error.expectedTransactionHash, /^[0-9a-f]{64}$/);
    assert.equal(error.retryable, true);
    return true;
  });
});

test("a transport error while polling is an RPC error that keeps the submitted hash", async () => {
  const rpc = mockRpc({ polls: [new Error("502")] });
  await assert.rejects(cancelWithEvidence(fakeClient(sdk, TESTNET), flows[2][2], options(rpc)), (error) => {
    assert.equal(error.code, "rpc_error");
    assert.equal(error.transactionHash, transactionHashHex(rpc.state.sent[0]));
    return true;
  });
});

test("TRY_AGAIN_LATER is a retryable RPC error, not pending", async () => {
  const rpc = mockRpc({ send: { status: "TRY_AGAIN_LATER" } });
  await rejects(cancelWithEvidence(fakeClient(sdk, TESTNET), flows[2][2], options(rpc)), "rpc_error", /not submitted/);
});

for (const [name, send] of [
  ["missing hash", { hash: undefined }],
  ["empty hash", { hash: "" }],
  ["malformed hash", { hash: "XYZ" }],
  ["uppercase hash", { hash: "A".repeat(64) }],
  ["hash of a different transaction", { hash: "0".repeat(64) }],
]) {
  test(`a sendTransaction response with a ${name} is rejected`, async () => {
    const rpc = mockRpc({ send, polls: [successPoll(sdk)] });
    await rejects(cancelWithEvidence(fakeClient(sdk, TESTNET), flows[2][2], options(rpc)), "malformed_rpc_response");
  });
}

for (const [name, poll] of [
  ["missing ledger", { ledger: undefined }],
  ["ledger zero", { ledger: 0 }],
  ["negative ledger", { ledger: -1 }],
  ["fractional ledger", { ledger: 1.5 }],
  ["string ledger", { ledger: "4541400" }],
  ["missing close time", { createdAt: undefined }],
  ["missing return value", { returnValue: undefined }],
  ["different transaction hash", { txHash: "0".repeat(64) }],
  ["unknown status", { status: "MAYBE" }],
]) {
  test(`a getTransaction response with ${name} is rejected, never defaulted`, async () => {
    const rpc = mockRpc({ polls: [{ ...successPoll(sdk), ...poll }] });
    await rejects(cancelWithEvidence(fakeClient(sdk, TESTNET), flows[2][2], options(rpc)), "malformed_rpc_response");
  });
}

test("a failed transaction without a ledger is rejected", async () => {
  const rpc = mockRpc({ polls: [{ ...failedPoll(sdk), ledger: 0 }] });
  await rejects(cancelWithEvidence(fakeClient(sdk, TESTNET), flows[2][2], options(rpc)), "malformed_rpc_response");
});

for (const [name, passphrase, code] of [
  ["pubnet", Networks.PUBLIC, "unsupported_network"],
  ["futurenet", Networks.FUTURENET, "unsupported_network"],
  ["an unknown passphrase", "Synthetic Unknown Network ; 2026", "unsupported_network"],
  ["a missing passphrase", undefined, "invalid_configuration"],
  ["an empty passphrase", "", "invalid_configuration"],
]) {
  test(`${name} fails closed before building or signing anything`, async () => {
    const client = fakeClient(sdk, TESTNET);
    const signer = recordingSigner();
    const rpc = mockRpc();
    await rejects(cancelWithEvidence(client, flows[2][2], options(rpc, { networkPassphrase: passphrase, signer })), code);
    assert.equal(client.calls.length, 0);
    assert.equal(signer.calls.length, 0);
    assert.equal(rpc.state.sent.length, 0);
  });
}

test("the standalone network is supported for local development", async () => {
  const rpc = mockRpc({ polls: [successPoll(sdk)] });
  const evidence = await cancelWithEvidence(
    fakeClient(sdk, Networks.STANDALONE),
    flows[2][2],
    options(rpc, { networkPassphrase: Networks.STANDALONE }),
  );
  assert.equal(evidence.network, "standalone");
});

test("a client configured for another network is rejected", async () => {
  await rejects(
    cancelWithEvidence(fakeClient(sdk, Networks.STANDALONE), flows[2][2], options(mockRpc())),
    "invalid_configuration",
    /different network/,
  );
});

for (const [name, timing] of [
  ["zero timeout", { timeoutMs: 0 }],
  ["excessive timeout", { timeoutMs: 600_001 }],
  ["fast polling", { pollIntervalMs: 99 }],
  ["slow polling", { pollIntervalMs: 30_001 }],
  ["fractional interval", { pollIntervalMs: 250.5 }],
]) {
  test(`${name} is rejected`, async () => {
    await rejects(cancelWithEvidence(fakeClient(sdk, TESTNET), flows[2][2], options(mockRpc(), timing)), "invalid_configuration");
  });
}

test("a signer that alters the transaction is rejected before submission", async () => {
  const rpc = mockRpc({ polls: [successPoll(sdk)] });
  const signer = recordingSigner(() => ({ signedTxXdr: syntheticTransaction(sdk, TESTNET, "555").toXDR() }));
  await rejects(cancelWithEvidence(fakeClient(sdk, TESTNET), flows[2][2], options(rpc, { signer })), "signer_modified_transaction");
  assert.equal(rpc.state.sent.length, 0);
});

for (const [name, transform] of [
  ["returns an error", () => ({ signedTxXdr: "", error: { message: "user declined" } })],
  ["returns nothing", () => undefined],
  ["throws", () => {
    throw new Error("device locked");
  }],
]) {
  test(`a signer that ${name} is a signer rejection`, async () => {
    const rpc = mockRpc();
    await rejects(
      cancelWithEvidence(fakeClient(sdk, TESTNET), flows[2][2], options(rpc, { signer: recordingSigner(transform) })),
      "signer_rejected",
    );
    assert.equal(rpc.state.sent.length, 0);
  });
}

test("calls that need other signers' authorization entries are rejected", async () => {
  const other = sdk.StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 0x22));
  const client = fakeClient(sdk, TESTNET, { needsNonInvokerSigningBy: () => [other] });
  await rejects(settleWithEvidence(client, flows[1][2], options(mockRpc())), "additional_signers_required", new RegExp(other));
});

test("read-only and unsimulated calls are rejected", async () => {
  await rejects(cancelWithEvidence(fakeClient(sdk, TESTNET, { isReadCall: true }), flows[2][2], options(mockRpc())), "not_a_write");
  await rejects(cancelWithEvidence(fakeClient(sdk, TESTNET, { built: undefined }), flows[2][2], options(mockRpc())), "not_simulated");
});

test("assertConfirmedEvidence rejects incomplete or synthesized evidence", () => {
  const good = {
    status: "confirmed",
    method: "cancel",
    network: "testnet",
    transactionHash: "ab".repeat(32),
    ledger: 1,
    createdAt: 1,
    result: null,
  };
  assertConfirmedEvidence(good);
  for (const bad of [
    null,
    { ...good, status: "pending" },
    { ...good, transactionHash: undefined },
    { ...good, transactionHash: "" },
    { ...good, transactionHash: "ab".repeat(31) },
    { ...good, ledger: undefined },
    { ...good, ledger: 0 },
    { ...good, ledger: 1.5 },
    { ...good, ledger: "1" },
    { ...good, createdAt: 0 },
    (({ result, ...rest }) => rest)(good),
  ]) {
    assert.throws(() => assertConfirmedEvidence(bad));
  }
});
