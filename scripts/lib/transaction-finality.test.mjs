import assert from "node:assert/strict";
import test from "node:test";
import { pollTransaction, TransactionFinalityError } from "./transaction-finality.mjs";
import { fetchReceipt } from "./network-receipts.mjs";
const hash = "a".repeat(64);
function fixture(results, overrides = {}) {
  let time = 0;
  let calls = 0;
  return { options: { timeoutMs: 30, intervalMs: 10, maxAttempts: 5,
    now: () => time, sleep: async (ms) => { time += ms; },
    rpc: async (method, params, { timeoutMs }) => {
      assert.equal(method, "getTransaction"); assert.equal(params.hash, hash); assert.ok(timeoutMs > 0);
      return results[Math.min(calls++, results.length - 1)];
    }, ...overrides }, calls: () => calls };
}
for (const status of ["SUCCESS", "FAILED"]) {
  test(`pending transitions to ${status} with network evidence`, async () => {
    const f = fixture([{ status: "NOT_FOUND", latestLedger: 10 },
      { status, latestLedger: 11, ledger: 11, createdAt: "1700000000", resultXdr: "public-result" }]);
    const result = await pollTransaction(hash, f.options);
    assert.equal(result.status, status); assert.equal(result.ledger, 11);
    assert.equal(result.transactionHash, hash); assert.equal(result.attempts, 2);
    assert.equal(result.createdAt, "2023-11-14T22:13:20.000Z");
    assert.equal(result.resultMetadata.resultXdr, "public-result");
  });
}
test("expiry needs observed ledger beyond inclusive bound", async () => {
  const f = fixture([{ status: "NOT_FOUND", latestLedger: 20 }, { status: "NOT_FOUND", latestLedger: 21 }], { maxLedger: 20 });
  const result = await pollTransaction(hash, f.options);
  assert.equal(result.status, "EXPIRED"); assert.equal(result.attempts, 2); assert.equal(result.latestLedger, 21);
});
test("absence without ledger evidence times out, never expires", async () => {
  const f = fixture([{ status: "NOT_FOUND" }], { maxLedger: 20 });
  const result = await pollTransaction(hash, f.options);
  assert.equal(result.status, "TIMED_OUT"); assert.equal(result.elapsedMs, 30); assert.equal(f.calls(), 3);
});
test("attempt budget bounds polling even with frozen clock", async () => {
  const f = fixture([{ status: "PENDING", latestLedger: 10 }], { now: () => 0, sleep: async () => {}, maxAttempts: 2 });
  assert.equal((await pollTransaction(hash, f.options)).status, "TIMED_OUT"); assert.equal(f.calls(), 2);
});
test("malformed and transport outcomes fail closed", async () => {
  for (const result of [{ status: "SUCCESS" }, { status: "ACCEPTED" }]) {
    await assert.rejects(pollTransaction(hash, fixture([result]).options));
  }
  await assert.rejects(pollTransaction(hash, fixture([], { rpc: async () => { throw new Error("offline"); } }).options), /offline/);
});
test("receipt callers retain typed timeout and expiry outcomes", async () => {
  const f = fixture([{ status: "NOT_FOUND", latestLedger: 21 }], { maxLedger: 20 });
  await assert.rejects(fetchReceipt(hash, f.options), (error) => error instanceof TransactionFinalityError
    && error.outcome.status === "EXPIRED" && error.outcome.latestLedger === 21);
});
