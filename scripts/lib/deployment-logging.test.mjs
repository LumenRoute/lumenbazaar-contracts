import assert from "node:assert/strict";
import test from "node:test";
import { logDeployment, redactText, signerValues } from "./deployment-logging.mjs";
import { runStellar, runStellarTransaction, writeManifest } from "./stellar-cli.mjs";

const seed = `S${"A".repeat(55)}`; // Synthetic, never a funded signer.
const publicId = `G${"B".repeat(55)}`;
const hash = "c".repeat(64);
const phrase = "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu";

test("public source accounts remain visible; private signer arguments are redacted", () => {
  assert.deepEqual(signerValues(["--source-account", publicId, "--seed", seed]), [seed]);
});

test("dry-run command and manifest snapshots cannot leak source signer values", (t) => {
  const logs = [];
  t.mock.method(console, "log", (line) => logs.push(line));
  const previous = process.env.STELLAR_ACCOUNT;
  process.env.STELLAR_ACCOUNT = phrase;
  try {
    runStellar(["contract", "deploy", "--source-account", phrase, "--network", "testnet"], { dryRun: true });
    writeManifest("dry-run.json", { deployer: phrase, publicId, transactionHash: hash }, { dryRun: true });
    assert.ok(logs.length === 2);
    for (const line of logs) assert.ok(!line.includes(phrase));
    const snapshot = JSON.parse(logs[1]);
    assert.equal(snapshot.manifest.deployer, "<redacted>");
    assert.equal(snapshot.manifest.publicId, publicId);
    assert.equal(snapshot.manifest.transactionHash, hash);
  } finally {
    if (previous === undefined) delete process.env.STELLAR_ACCOUNT;
    else process.env.STELLAR_ACCOUNT = previous;
  }
});

test("redacts multiline, encoded and repeated configured secrets while retaining public evidence", () => {
  const secret = `${phrase}\nsecond line`;
  const forms = [secret, JSON.stringify(secret).slice(1, -1), encodeURIComponent(secret), Buffer.from(secret).toString("base64")];
  const output = redactText(`${forms.join(" | ")} ${secret} ${seed} ${publicId} ${hash} Error(Contract, #8)`, [secret]);
  for (const form of [...forms, seed]) assert.ok(!output.includes(form));
  for (const safe of [publicId, hash, "Error(Contract, #8)"]) assert.ok(output.includes(safe));
});

test("structured logs sanitize nested fields before serialization", () => {
  let output;
  logDeployment("failed", { command: ["deploy", phrase], stderr: `${phrase}\n${phrase}` }, {
    redact: [phrase], sink: (line) => { output = line; },
  });
  assert.deepEqual(JSON.parse(output), { event: "failed", command: ["deploy", "<redacted>"], stderr: "<redacted>\n<redacted>" });
});

test("all CLI failures pipe diagnostics and never include signer material", () => {
  for (const run of [runStellar, runStellarTransaction]) {
    assert.throws(() => run(["contract", "deploy", "--source-account", phrase], {
      execute: (_command, _args, options) => {
        assert.notEqual(options.stdio, "inherit");
        return { status: 1, stderr: `failed ${phrase} ${seed}\n${publicId} ${hash} Error(Contract, #8)` };
      },
    }), (error) => !error.message.includes(phrase) && !error.message.includes(seed)
      && error.message.includes(publicId) && error.message.includes(hash));
  }
});

test("environment-configured key patterns are redacted without hiding safe command arguments", () => {
  process.env.LUMENBAZAAR_PRIVATE_KEY = "synthetic-private-key-value";
  try {
    assert.equal(redactText("deploy --network testnet synthetic-private-key-value"), "deploy --network testnet <redacted>");
  } finally { delete process.env.LUMENBAZAAR_PRIVATE_KEY; }
});
