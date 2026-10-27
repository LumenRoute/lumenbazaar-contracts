// Unit tests for the encoding vector compatibility gate and the TypeScript
// verifier. Run after building the binding:
//   npm --prefix bindings/upto-session run build
//   node --test scripts/lib/encoding-vectors.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  CHANGELOG_FILE,
  compareLocks,
  sha256Hex,
  vectorFileName,
  verifyLock,
  verifyVectors,
} from "./encoding-vectors.mjs";

const syntheticFile = (version) =>
  Buffer.from(`${JSON.stringify({ schema: "lumenbazaar/encoding-vectors", version })}\n`);

function fixture({ current = 1, changelog = "## v1\n", mutate = () => {} } = {}) {
  const files = new Map([[CHANGELOG_FILE, Buffer.from(changelog)]]);
  const versions = {};
  for (let version = 1; version <= current; version += 1) {
    const bytes = syntheticFile(version);
    files.set(vectorFileName(version), bytes);
    versions[String(version)] = {
      file: vectorFileName(version),
      sha256: sha256Hex(bytes),
      status: version === current ? "current" : "retained",
    };
  }
  const lock = { current, versions };
  mutate({ lock, files });
  return { lock, readFile: (name) => files.get(name) ?? null };
}

test("a consistent lock passes", () => {
  const { lock, readFile } = fixture({ current: 2, changelog: "## v1\n## v2\n" });
  assert.deepEqual(verifyLock(lock, readFile), []);
});

test("editing a published vector file without a new version fails", () => {
  const { lock, readFile } = fixture({
    mutate: ({ files }) => files.set(vectorFileName(1), Buffer.from('{"version":1,"changed":true}\n')),
  });
  assert.match(verifyLock(lock, readFile).join("\n"), /published vectors are immutable/);
});

test("a version without a changelog entry fails", () => {
  const { lock, readFile } = fixture({ current: 2, changelog: "## v1\n" });
  assert.match(verifyLock(lock, readFile).join("\n"), /no "## v2" entry/);
});

test("deleting an older version file fails", () => {
  const { lock, readFile } = fixture({
    current: 2,
    changelog: "## v1\n## v2\n",
    mutate: ({ files }) => files.delete(vectorFileName(1)),
  });
  assert.match(verifyLock(lock, readFile).join("\n"), /v1\.json is missing/);
});

test("a gap in the version sequence fails", () => {
  const { lock, readFile } = fixture({
    current: 2,
    changelog: "## v1\n## v2\n",
    mutate: ({ lock }) => delete lock.versions["1"],
  });
  assert.match(verifyLock(lock, readFile).join("\n"), /version 1 is missing/);
});

test("a file whose declared version disagrees with the lock fails", () => {
  const { lock, readFile } = fixture({
    mutate: ({ lock, files }) => {
      const bytes = syntheticFile(2);
      files.set(vectorFileName(1), bytes);
      lock.versions["1"].sha256 = sha256Hex(bytes);
    },
  });
  assert.match(verifyLock(lock, readFile).join("\n"), /version 1$/m);
});

test("a malformed lock fails closed", () => {
  assert.notDeepEqual(verifyLock({}, () => null), []);
  assert.notDeepEqual(verifyLock({ current: 1, versions: [] }, () => null), []);
});

test("changing a version that exists on the base fails", () => {
  const base = fixture().lock;
  const head = structuredClone(base);
  head.versions["1"].sha256 = "0".repeat(64);
  assert.match(compareLocks(base, head).join("\n"), /requires a new version/);
});

test("adding a new version on top of the base passes", () => {
  const base = fixture().lock;
  const head = fixture({ current: 2, changelog: "## v1\n## v2\n" }).lock;
  assert.deepEqual(compareLocks(base, head), []);
});

test("removing or reactivating a base version fails", () => {
  const base = fixture({ current: 2, changelog: "## v1\n## v2\n" }).lock;
  base.versions["1"].status = "retired";
  const removed = structuredClone(base);
  delete removed.versions["1"];
  assert.match(compareLocks(base, removed).join("\n"), /append-only/);
  const reactivated = structuredClone(base);
  reactivated.versions["1"].status = "retained";
  assert.match(compareLocks(base, reactivated).join("\n"), /cannot be reactivated/);
});

test("a base without a lock is accepted (first introduction)", () => {
  assert.deepEqual(compareLocks(null, fixture().lock), []);
});

// The verifier tests use the committed v1 vectors and the built binding.
const sdk = await import("../../bindings/upto-session/dist/index.js");
const committed = JSON.parse(
  readFileSync(new URL("../../artifacts/backend-handoff/encoding-vectors.v1.json", import.meta.url), "utf8"),
);

test("the committed vectors verify against the TypeScript encoding path", () => {
  assert.deepEqual(verifyVectors(committed, sdk), []);
});

for (const [name, tamper, pattern] of [
  ["session preimage", (v) => (v.sessionIds[0].preimageXdrHex = `00${v.sessionIds[0].preimageXdrHex.slice(2)}`), /preimage differs/],
  ["session idempotency key", (v) => (v.sessionIds[0].idempotencyKeyHex = "07".repeat(32)), /differs/],
  ["NFC flag", (v) => (v.networkPassphrases.find((p) => p.name === "latin-decomposed-nfd").nfc = true), /NFC flag/],
  ["usage hash", (v) => (v.usageCommitments[0].usageHashHex = "00".repeat(32)), /usage hash differs/],
  ["receipt canonical bytes", (v) => (v.usageReceipts.valid[1].canonicalUtf8 += " "), /canonical encoding differs/],
  ["invalid receipt marked valid", (v) => v.usageReceipts.invalid.push({ name: "ok", error: "x", receipt: v.usageReceipts.valid[0].receipt }), /accepted a receipt/],
  ["address XDR", (v) => (v.addresses[0].scValXdrHex = "00"), /ScVal XDR differs/],
  ["amount acceptance", (v) => (v.amounts.find((a) => a.name === "zero").createSessionAccepted = true), /acceptance/],
  ["event data", (v) => (v.events[0].expected.data.event_version.value = 99), /decoded data differs/],
  ["contract error code", (v) => (v.sessionExpiry[0].contractError.code = 999), /typed error map/],
]) {
  test(`the verifier rejects a tampered ${name}`, () => {
    const tampered = structuredClone(committed);
    tamper(tampered);
    assert.match(verifyVectors(tampered, sdk).join("\n"), pattern);
  });
}

test("the verifier fails closed on a malformed file", () => {
  assert.notDeepEqual(verifyVectors({}, sdk), []);
  assert.notDeepEqual(verifyVectors({ ...committed, events: [] }, sdk), []);
});
