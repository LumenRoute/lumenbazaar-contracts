import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { repoRoot } from "./lib/stellar-cli.mjs";
import {
  buildConfig,
  createRpc,
  parseTransactionHash,
  runSmoke,
  sha256Hex,
  validateReport,
} from "./lib/testnet-smoke.mjs";

const manifest = JSON.parse(
  readFileSync(join(repoRoot, "deployments", "testnet-2026-10-07.json"), "utf8"),
);
const environment = {
  LUMENBAZAAR_SMOKE_BUYER: "smoke-buyer",
  LUMENBAZAAR_SMOKE_SELLER: "smoke-seller",
  LUMENBAZAAR_SMOKE_TOKEN_ADMIN: "smoke-token-admin",
};
const accounts = {
  "smoke-buyer": `G${"A".repeat(55)}`,
  "smoke-seller": `G${"B".repeat(55)}`,
  "smoke-token-admin": `G${"C".repeat(55)}`,
};
const commit = "a".repeat(40);

/** In-memory stand-in for the Stellar CLI and RPC. No network, no signing. */
function fakeNetwork({ replayBehavior = "reject" } = {}) {
  const config = buildConfig(environment, manifest);
  const balances = new Map([
    [accounts["smoke-buyer"], 0n],
    [accounts["smoke-seller"], 0n],
    [config.uptoSession, 0n],
  ]);
  const sessions = new Map();
  const transactions = new Map();
  let ledger = 5_100_000;
  let counter = 0;

  const record = () => {
    ledger += 2;
    counter += 1;
    const hash = sha256Hex(`tx-${counter}`);
    transactions.set(hash, ledger);
    return hash;
  };
  const valueAfter = (call, name) => call[call.indexOf(name) + 1];

  const exec = (args) => {
    if (args[0] === "keys") {
      return { status: 0, stdout: `${accounts[args[2]]}\n`, stderr: "" };
    }
    const call = args.slice(args.indexOf("--") + 1);
    const send = !args.includes("no");
    const ok = (stdout, stderr = "") => ({ status: 0, stdout, stderr });
    switch (call[0]) {
      case "interface_version":
        return ok("2");
      case "get_asset_max_session_amount":
        return ok('"1000000000"');
      case "balance":
        return ok(`"${balances.get(valueAfter(call, "--id")) ?? 0n}"`);
      case "mint": {
        const to = valueAfter(call, "--to");
        balances.set(to, balances.get(to) + BigInt(valueAfter(call, "--amount")));
        const hash = record();
        return ok("null", `Transaction hash is ${hash}\nhttps://stellar.expert/explorer/testnet/tx/${hash}`);
      }
      case "create_session": {
        const cap = BigInt(valueAfter(call, "--max_amount"));
        const buyer = valueAfter(call, "--buyer");
        balances.set(buyer, balances.get(buyer) - cap);
        balances.set(manifestUpto(), balances.get(manifestUpto()) + cap);
        const hash = record();
        const id = sha256Hex(`session-${counter}`);
        sessions.set(id, { cap, status: "Open", buyer });
        return ok(`"${id}"`, `https://stellar.expert/explorer/testnet/tx/${hash}`);
      }
      case "settle": {
        const session = sessions.get(valueAfter(call, "--session_id"));
        if (session.status !== "Open") {
          if (replayBehavior === "succeed") {
            return ok("null", `https://stellar.expert/explorer/testnet/tx/${record()}`);
          }
          const code = replayBehavior === "wrong-error" ? "#8" : "#6";
          return { status: 1, stdout: "", stderr: `error: simulation failed: Error(Contract, ${code})` };
        }
        const amount = BigInt(valueAfter(call, "--actual_amount"));
        session.status = "Settled";
        balances.set(manifestUpto(), balances.get(manifestUpto()) - session.cap);
        balances.set(accounts["smoke-seller"], balances.get(accounts["smoke-seller"]) + amount);
        balances.set(session.buyer, balances.get(session.buyer) + session.cap - amount);
        return ok("null", `https://stellar.expert/explorer/testnet/tx/${record()}`);
      }
      case "cancel": {
        const session = sessions.get(valueAfter(call, "--session_id"));
        session.status = "Cancelled";
        balances.set(manifestUpto(), balances.get(manifestUpto()) - session.cap);
        balances.set(session.buyer, balances.get(session.buyer) + session.cap);
        return ok("null", `https://stellar.expert/explorer/testnet/tx/${record()}`);
      }
      case "get_session":
        return ok(JSON.stringify({ status: sessions.get(valueAfter(call, "--session_id")).status }));
      default:
        throw new Error(`unexpected call ${call[0]} (send=${send})`);
    }
  };
  const manifestUpto = () => config.uptoSession;

  const rpc = {
    latestLedger: async () => ledger,
    confirmed: async (hash) => ({
      transactionHash: hash,
      ledger: transactions.get(hash),
      createdAt: "2026-10-17T00:00:00.000Z",
    }),
  };
  return { config, exec, rpc, balances };
}

const run = (network) =>
  runSmoke({
    config: network.config,
    exec: network.exec,
    rpc: network.rpc,
    sourceCommit: commit,
    sourceTreeClean: true,
    now: () => new Date("2026-10-17T00:00:00Z"),
    runId: "test-run",
  });

test("a bounded lifecycle records create, settle, separate cancel, and a rejected replay", async () => {
  const report = await run(fakeNetwork());

  assert.equal(report.sourceCommit, commit);
  assert.equal(report.mainnetEvidence, false);
  assert.match(report.sessions.settled.create.transactionHash, /^[a-f0-9]{64}$/);
  assert.match(report.sessions.settled.settle.transactionHash, /^[a-f0-9]{64}$/);
  assert.ok(report.sessions.settled.settle.ledger > report.sessions.settled.create.ledger);
  assert.notEqual(report.sessions.settled.sessionId, report.sessions.cancelled.sessionId);
  assert.ok(report.sessions.cancelled.cancel.ledger > report.sessions.cancelled.create.ledger);
  assert.equal(report.sessions.settled.replaySettle.transactionHash, null);
  assert.match(report.sessions.settled.replaySettle.result, /#6 SessionAlreadySettled/);
  assert.equal(report.balances.after.escrowContract, report.balances.before.escrowContract);
  assert.equal(report.mint.amount, "20000000");
  assert.equal(validateReport(report), true);
});

test("the report holds no secret material, local paths, or identity aliases", async () => {
  const text = JSON.stringify(await run(fakeNetwork()));

  assert.doesNotMatch(text, /\bS[A-Z2-7]{55}\b/);
  assert.doesNotMatch(text, /\/home\/|\/Users\/|[A-Za-z]:\\/);
  for (const alias of Object.keys(accounts)) {
    assert.ok(!text.includes(alias), `${alias} leaked into the report`);
  }
  assert.match(text, /<buyer-identity>/);
});

test("a replay that succeeds or fails for another reason aborts the run", async () => {
  await assert.rejects(run(fakeNetwork({ replayBehavior: "succeed" })), /unexpectedly succeeded/);
  await assert.rejects(run(fakeNetwork({ replayBehavior: "wrong-error" })), /unexpected reason/);
});

test("configuration fails closed outside a bounded testnet run", () => {
  assert.throws(() => buildConfig({ ...environment, STELLAR_NETWORK: "mainnet" }, manifest), /testnet/);
  assert.throws(
    () => buildConfig({ ...environment, LUMENBAZAAR_SMOKE_BUYER: `S${"A".repeat(55)}` }, manifest),
    /never a secret/,
  );
  assert.throws(() => buildConfig({ ...environment, LUMENBAZAAR_SMOKE_CAP: "100000001" }, manifest), /between/);
  assert.throws(() => buildConfig({ ...environment, LUMENBAZAAR_SMOKE_CAP: "0" }, manifest), /positive/);
  assert.throws(
    () => buildConfig({ ...environment, LUMENBAZAAR_SMOKE_RPC_URL: "https://rpc.mainnet.example" }, manifest),
    /testnet endpoint/,
  );
  assert.throws(
    () => buildConfig({ ...environment, LUMENBAZAAR_SMOKE_SETTLE_AMOUNT: "10000000" }, manifest),
    /between/,
  );
  assert.throws(
    () => buildConfig(environment, { ...manifest, environment: "mainnet" }),
    /testnet manifest/,
  );
});

test("transaction hash parsing requires exactly one unambiguous hash", () => {
  const one = "b".repeat(64);
  assert.equal(parseTransactionHash(`x https://stellar.expert/explorer/testnet/tx/${one}`), one);
  assert.equal(parseTransactionHash(`Transaction hash is ${one}\n.../tx/${one}`), one);
  assert.throws(() => parseTransactionHash("no hash here"), /exactly one/);
  assert.throws(
    () => parseTransactionHash(`/tx/${one} /tx/${"c".repeat(64)}`),
    /exactly one/,
  );
});

test("validateReport rejects missing evidence and unsafe claims", async () => {
  const good = await run(fakeNetwork());
  const clone = () => structuredClone(good);
  const cases = [
    [(r) => (r.mainnetEvidence = true), /mainnet/],
    [(r) => delete r.sourceCommit, /source commit/],
    [(r) => (r.network = "public"), /testnet/],
    [(r) => (r.sessions.settled.replaySettle.result = "ok"), /Replay/],
    [(r) => (r.sessions.settled.replaySettle.transactionHash = "a".repeat(64)), /Replay/],
    [(r) => (r.sessions.cancelled.sessionId = r.sessions.settled.sessionId), /two separate/],
    [(r) => (r.sessions.settled.settle.transactionHash = "nope"), /transaction hash/],
    [(r) => (r.balances.after.buyer = "0"), /conserve/],
    [(r) => (r.commands = [`stellar keys secret S${"A".repeat(55)}`]), /signing material/],
  ];
  for (const [mutate, message] of cases) {
    const report = clone();
    mutate(report);
    assert.throws(() => validateReport(report), message);
  }
});

test("the RPC client waits for confirmation and rejects failed transactions", async () => {
  const responses = [
    { status: "NOT_FOUND" },
    { status: "SUCCESS", ledger: 42, createdAt: "1792195200" },
  ];
  const rpc = createRpc(
    "https://soroban-testnet.stellar.org",
    async () => ({ json: async () => ({ result: responses.shift() }) }),
    async () => {},
  );
  const evidence = await rpc.confirmed("d".repeat(64));
  assert.equal(evidence.ledger, 42);
  assert.equal(evidence.createdAt, "2026-10-17T00:00:00.000Z");

  const failing = createRpc(
    "https://soroban-testnet.stellar.org",
    async () => ({ json: async () => ({ result: { status: "FAILED" } }) }),
    async () => {},
  );
  await assert.rejects(failing.confirmed("e".repeat(64)), /failed on-chain/);
});

test("the runner is opt-in: default is a dry run and execution needs the explicit gate", () => {
  const script = join(repoRoot, "scripts", "testnet", "smoke-lifecycle.mjs");
  const env = { ...process.env, LUMENBAZAAR_LIVE_SMOKE: "" };

  const dryRun = spawnSync("node", [script], { encoding: "utf8", env });
  assert.equal(dryRun.status, 0);
  assert.match(dryRun.stdout, /dry run: no network access, signing, or transactions/);

  const gated = spawnSync("node", [script, "--execute"], { encoding: "utf8", env });
  assert.notEqual(gated.status, 0);
  assert.match(gated.stderr, /opt-in/);
});
