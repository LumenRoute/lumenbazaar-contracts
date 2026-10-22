import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  collectPublishedTransactions,
  exitCodeFor,
  exitCodes,
  renderSummary,
  verifyTransactions,
} from "./lib/horizon-evidence.mjs";

const repoRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const verifier = join(repoRoot, "scripts", "verify-horizon-evidence.mjs");
const account = (letter) => `G${letter.repeat(55)}`;
const hash = (byte) => byte.repeat(32);
const noSleep = async () => {};

const deployment = {
  schemaVersion: 2,
  deployer: account("D"),
  admin: account("A"),
  contracts: {
    "upto-session": {
      upload: { transactionHash: hash("a1"), ledger: 10, createdAt: "2026-10-21T08:00:10Z" },
      deploy: { transactionHash: hash("a2"), ledger: 11, createdAt: "2026-10-21T08:00:15Z" },
      initialize: { transactionHash: hash("a3"), ledger: 12, createdAt: "2026-10-21T08:00:20Z" },
    },
  },
};
const liveEvidence = {
  kind: "live-rejection-evidence",
  setupTransactions: [
    { name: "create", transactionHash: hash("b1"), ledger: 20, createdAt: "2026-10-21T08:01:00Z", sourceAccount: account("B"), expectedSuccessful: true },
  ],
  cases: [
    {
      name: "over_cap_settlement",
      recordedOn: "ledger",
      transactionHash: hash("b2"),
      ledger: 21,
      createdAt: "2026-10-21T08:01:05Z",
      sourceAccount: account("S"),
      expectedSuccessful: false,
    },
    { name: "simulated", recordedOn: "simulation-only", transactionHash: null, observedAtLedger: 22 },
  ],
};

function horizonRecords() {
  const records = new Map();
  for (const { transactions } of [
    collectPublishedTransactions("deployments/testnet-2026-10-21.json", deployment),
    collectPublishedTransactions("artifacts/testnet/live-evidence-2026-10-21.json", liveEvidence),
  ]) {
    for (const entry of transactions) {
      records.set(entry.transactionHash, {
        hash: entry.transactionHash,
        ledger: entry.ledger,
        created_at: entry.createdAt,
        source_account: entry.expectedSources[0],
        successful: entry.expectedSuccessful,
      });
    }
  }
  return records;
}

function fakeFetch(records, overrides = {}) {
  const calls = [];
  const fetchImpl = async (url) => {
    const transactionHash = url.split("/").pop();
    calls.push(transactionHash);
    const override = overrides[transactionHash];
    if (typeof override === "function") return override(calls.filter((call) => call === transactionHash).length);
    const record = records.get(transactionHash);
    return record ? response(200, record) : response(404, { status: 404 });
  };
  return { fetchImpl, calls };
}

function response(status, body, headers = {}) {
  return { status, ok: status >= 200 && status < 300, headers: new Headers(headers), json: async () => body };
}

function allTransactions() {
  return [
    ...collectPublishedTransactions("deployments/testnet-2026-10-21.json", deployment).transactions,
    ...collectPublishedTransactions("artifacts/testnet/live-evidence-2026-10-21.json", liveEvidence).transactions,
  ];
}

test("deployment sources follow the published signer rule and simulation-only cases are listed", () => {
  const { transactions } = collectPublishedTransactions("d.json", deployment);
  assert.deepEqual(
    transactions.map((entry) => entry.expectedSources[0]),
    [account("D"), account("D"), account("A")],
  );
  const live = collectPublishedTransactions("e.json", liveEvidence);
  assert.equal(live.transactions.length, 2);
  assert.deepEqual(live.simulationOnly, [{ file: "e.json", label: "case.simulated" }]);
});

test("an expected on-ledger rejection verifies as failed, not as a mismatch", async () => {
  const { fetchImpl } = fakeFetch(horizonRecords());
  const results = await verifyTransactions(allTransactions(), { fetchImpl, sleep: noSleep });
  assert.equal(exitCodeFor(results), exitCodes.verified);
  const rejected = results.find((entry) => entry.label === "case.over_cap_settlement");
  assert.equal(rejected.status, "verified");
  assert.equal(rejected.expectedSuccessful, false);
});

test("ledger, close time, source, and success differences are mismatches", async () => {
  const records = horizonRecords();
  records.set(hash("a1"), { ...records.get(hash("a1")), ledger: 99 });
  records.set(hash("a2"), { ...records.get(hash("a2")), created_at: "2026-10-21T09:00:00Z" });
  records.set(hash("a3"), { ...records.get(hash("a3")), source_account: account("X") });
  records.set(hash("b2"), { ...records.get(hash("b2")), successful: true });
  records.delete(hash("b1"));
  const { fetchImpl } = fakeFetch(records);
  const results = await verifyTransactions(allTransactions(), { fetchImpl, sleep: noSleep });
  assert.equal(exitCodeFor(results), exitCodes.mismatch);
  const detail = Object.fromEntries(results.map((entry) => [entry.label, entry.differences.join("; ")]));
  assert.match(detail["upto-session.upload"], /ledger 99 != published 10/);
  assert.match(detail["upto-session.deploy"], /close time/);
  assert.match(detail["upto-session.initialize"], /not the published signer/);
  assert.match(detail["case.over_cap_settlement"], /published expected outcome is failure/);
  assert.match(detail["setup.create"], /not found on Horizon/);
  assert.ok(results.every((entry) => entry.status !== "outage"));
});

test("timeouts, 5xx, and 429 are retried with bounded backoff and then reported as outage", async () => {
  const waits = [];
  const sleep = async (milliseconds) => waits.push(milliseconds);
  const timeout = () => Promise.reject(Object.assign(new Error("timed out"), { name: "TimeoutError" }));
  const { fetchImpl, calls } = fakeFetch(horizonRecords(), {
    [hash("a1")]: timeout,
    [hash("a2")]: () => response(503, {}),
    [hash("a3")]: () => response(429, {}, { "retry-after": "2" }),
  });
  const results = await verifyTransactions(allTransactions(), { fetchImpl, sleep });
  assert.equal(exitCodeFor(results), exitCodes.outage);
  for (const transactionHash of [hash("a1"), hash("a2"), hash("a3")]) {
    assert.equal(calls.filter((call) => call === transactionHash).length, 4, "one attempt plus three retries");
  }
  assert.deepEqual(waits, [1000, 2000, 4000, 1000, 2000, 4000, 2000, 2000, 2000]);
  const outage = results.filter((entry) => entry.status === "outage");
  assert.equal(outage.length, 3);
  assert.match(outage[0].differences[0], /timeout/);
  assert.match(outage[2].differences[0], /HTTP 429/);
});

test("a transient failure followed by success verifies", async () => {
  const records = horizonRecords();
  const { fetchImpl } = fakeFetch(records, {
    [hash("a1")]: (attempt) => (attempt === 1 ? response(502, {}) : response(200, records.get(hash("a1")))),
  });
  const results = await verifyTransactions(allTransactions(), { fetchImpl, sleep: noSleep });
  assert.equal(exitCodeFor(results), exitCodes.verified);
});

test("a mismatch takes precedence over a concurrent outage without relabelling either", async () => {
  const records = horizonRecords();
  records.set(hash("a1"), { ...records.get(hash("a1")), ledger: 1 });
  const { fetchImpl } = fakeFetch(records, { [hash("a2")]: () => response(500, {}) });
  const results = await verifyTransactions(allTransactions(), { fetchImpl, sleep: noSleep });
  assert.equal(exitCodeFor(results), exitCodes.mismatch);
  assert.equal(results.find((entry) => entry.label === "upto-session.upload").status, "mismatch");
  assert.equal(results.find((entry) => entry.label === "upto-session.deploy").status, "outage");
  const summary = renderSummary(results, [], { fileLink: (file) => `https://example.test/blob/abc123/${file}` });
  assert.match(summary, /MISMATCH: Horizon contradicts published evidence/);
  assert.match(summary, /\| MISMATCH \|/);
  assert.match(summary, /\| OUTAGE \|/);
  assert.match(summary, /\(https:\/\/example\.test\/blob\/abc123\/deployments\/testnet-2026-10-21\.json\)/);
});

function writeEvidenceRoot() {
  const root = mkdtempSync(join(tmpdir(), "lumenbazaar-horizon-"));
  mkdirSync(join(root, "deployments"));
  mkdirSync(join(root, "artifacts", "testnet"), { recursive: true });
  writeFileSync(join(root, "deployments", "testnet-2026-10-21.json"), JSON.stringify(deployment));
  writeFileSync(join(root, "artifacts", "testnet", "live-evidence-2026-10-21.json"), JSON.stringify(liveEvidence));
  return root;
}

async function runAgainst(handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const root = writeEvidenceRoot();
  const summary = join(root, "summary.md");
  try {
    const child = spawn(
      process.execPath,
      [
        verifier,
        "--evidence-root",
        root,
        "--horizon-url",
        `http://127.0.0.1:${server.address().port}`,
        "--summary",
        summary,
      ],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          GITHUB_SERVER_URL: "https://github.com",
          GITHUB_REPOSITORY: "LumenRoute/lumenbazaar-contracts",
          GITHUB_SHA: "0123456789abcdef0123456789abcdef01234567",
        },
      },
    );
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += chunk));
    const status = await new Promise((resolve) => child.on("close", resolve));
    return { status, stderr, summary: readFileSync(summary, "utf8") };
  } finally {
    server.close();
    rmSync(root, { recursive: true, force: true });
  }
}

test("the CLI exits 0 and links manifests at the tested commit", async () => {
  const records = horizonRecords();
  const result = await runAgainst((request, reply) => {
    const record = records.get(request.url.split("/").pop());
    reply.writeHead(record ? 200 : 404, { "content-type": "application/json" });
    reply.end(JSON.stringify(record ?? { status: 404 }));
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.summary, /VERIFIED/);
  assert.match(
    result.summary,
    /https:\/\/github\.com\/LumenRoute\/lumenbazaar-contracts\/blob\/0123456789abcdef0123456789abcdef01234567\/deployments\/testnet-2026-10-21\.json/,
  );
});

test("the CLI exits 1 with a mismatch message when Horizon contradicts evidence", async () => {
  const records = horizonRecords();
  records.set(hash("b2"), { ...records.get(hash("b2")), successful: true });
  const result = await runAgainst((request, reply) => {
    reply.writeHead(200, { "content-type": "application/json" });
    reply.end(JSON.stringify(records.get(request.url.split("/").pop())));
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /HORIZON_MISMATCH/);
  assert.doesNotMatch(result.stderr, /HORIZON_OUTAGE/);
});

test("the CLI exits 2 with an outage message when Horizon keeps failing", async () => {
  const result = await runAgainst((request, reply) => {
    reply.writeHead(503);
    reply.end();
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /HORIZON_OUTAGE/);
  assert.doesNotMatch(result.stderr, /HORIZON_MISMATCH/);
  assert.match(result.summary, /OUTAGE: Horizon could not be reached/);
});
