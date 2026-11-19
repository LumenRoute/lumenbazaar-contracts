import assert from "node:assert/strict";
import test from "node:test";
import {
  compareStorageCorpusLocks,
  sha256Buffer,
  verifyStorageCorpusDocument,
  verifyStorageCorpusLock,
} from "./storage-corpus.mjs";

function makeValidCorpus(version = 3) {
  return {
    schema: "lumenbazaar/storage-serialization-corpus",
    storageLayoutVersion: version,
    vectors: [
      {
        name: "instance-admin",
        tier: "instance",
        keyVariant: "Admin",
        valueType: "Address",
        keyXdrHex: "00000010",
        valueXdrHex: "00000012",
      },
      {
        name: "persistent-liability",
        tier: "persistent",
        keyVariant: "Liability",
        valueType: "i128",
        keyXdrHex: "00000010",
        valueXdrHex: "0000000a",
      },
    ],
  };
}

test("valid storage corpus and lock with migration evidence pass verification", () => {
  const corpusBuf = Buffer.from(`${JSON.stringify(makeValidCorpus(3), null, 2)}\n`, "utf8");
  const migrationBuf = Buffer.from(
    JSON.stringify({ fromInterfaceVersion: 2, toInterfaceVersion: 3 }),
    "utf8",
  );
  const lock = {
    schema: "lumenbazaar/storage-corpus-lock",
    currentLayoutVersion: 3,
    versions: {
      "3": {
        file: "storage-corpus-v3.json",
        sha256: sha256Buffer(corpusBuf),
        migrationEvidence: "migrations/v2-to-v3.json",
      },
    },
  };
  const files = new Map([
    ["storage-corpus-v3.json", corpusBuf],
    ["migrations/v2-to-v3.json", migrationBuf],
  ]);

  assert.deepEqual(
    verifyStorageCorpusLock(lock, (name) => files.get(name) ?? null),
    [],
  );
});

test("drifted corpus bytes or missing migration evidence fail closed", () => {
  const corpusBuf = Buffer.from(`${JSON.stringify(makeValidCorpus(3), null, 2)}\n`, "utf8");
  const lock = {
    schema: "lumenbazaar/storage-corpus-lock",
    currentLayoutVersion: 3,
    versions: {
      "3": {
        file: "storage-corpus-v3.json",
        sha256: "0".repeat(64),
        migrationEvidence: "migrations/missing.json",
      },
    },
  };
  const files = new Map([["storage-corpus-v3.json", corpusBuf]]);
  const errors = verifyStorageCorpusLock(lock, (name) => files.get(name) ?? null);
  assert.ok(errors.some((e) => /sha256 mismatch/.test(e)));
  assert.ok(errors.some((e) => /missing migration evidence/.test(e)));
});

test("mutating an existing locked layout version fails base lock comparison", () => {
  const baseLock = {
    currentLayoutVersion: 3,
    versions: {
      "3": { file: "storage-corpus-v3.json", sha256: "a".repeat(64) },
    },
  };
  const mutatedLock = {
    currentLayoutVersion: 3,
    versions: {
      "3": { file: "storage-corpus-v3.json", sha256: "b".repeat(64) },
    },
  };
  const errors = compareStorageCorpusLocks(baseLock, mutatedLock);
  assert.ok(errors.some((e) => /was mutated/.test(e)));
});

test("corpus document rejects missing tiers, unsorted vectors, or embedded secrets", () => {
  const bad = makeValidCorpus(3);
  bad.vectors = [
    {
      name: "z-instance",
      tier: "instance",
      keyVariant: "Admin",
      valueType: "Address",
      keyXdrHex: "00000010",
      valueXdrHex: "00000012",
    },
    {
      name: "a-instance",
      tier: "instance",
      keyVariant: "Admin",
      valueType: "Address",
      keyXdrHex: "00000010",
      valueXdrHex: "00000012",
      leaked: `S${"A".repeat(55)}`,
    },
  ];
  const errors = verifyStorageCorpusDocument(bad, 3);
  assert.ok(errors.some((e) => /not sorted deterministically/.test(e)));
  assert.ok(errors.some((e) => /persistent storage vector/.test(e)));
  assert.ok(errors.some((e) => /stellar-secret-seed/.test(e)));
});
