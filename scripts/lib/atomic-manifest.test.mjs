import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  ManifestConcurrencyError,
  ManifestSecretError,
  ManifestStaleWriteError,
  ManifestValidationError,
  atomicReplaceFile,
  defaultFsOps,
  snapshotFile,
  writeJsonAtomic,
} from "./atomic-manifest.mjs";
import {
  mergeContracts,
  readManifest,
  readManifestWithSnapshot,
  writeManifest,
} from "./stellar-cli.mjs";

const VALID_CONTRACT_ID = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM";
const SECOND_CONTRACT_ID = "CDA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4CFV6";
const VALID_HASH = "a".repeat(64);
const SYNTHETIC_SEED = `S${"A".repeat(55)}`;
const SYNTHETIC_MNEMONIC = "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda omega";

function makeTempDir(prefix = "atomic-manifest-") {
  return mkdtempSync(join(tmpdir(), prefix));
}

function baseManifest() {
  return {
    network: "testnet",
    contracts: {
      "upto-session": {
        name: "upto-session",
        contractId: VALID_CONTRACT_ID,
        wasmHash: VALID_HASH,
      },
    },
  };
}

test("atomic write creates valid manifest and leaves no temp or lock files behind", () => {
  const dir = makeTempDir();
  try {
    const manifestPath = join(dir, "testnet.json");
    const result = writeManifest(manifestPath, baseManifest());
    assert.ok(result.sha256.length === 64);

    const parsed = readManifest(manifestPath);
    assert.equal(parsed.network, "testnet");
    assert.equal(parsed.contracts["upto-session"].contractId, VALID_CONTRACT_ID);
    assert.ok(typeof parsed.generatedAt === "string");
    assert.deepEqual(readdirSync(dir), ["testnet.json"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("existing valid manifest survives schema validation failure", () => {
  const dir = makeTempDir();
  try {
    const manifestPath = join(dir, "testnet.json");
    writeManifest(manifestPath, baseManifest());
    const originalRaw = readFileSync(manifestPath, "utf8");

    assert.throws(
      () =>
        writeManifest(manifestPath, {
          network: "unsupported-net",
          contracts: {},
        }),
      ManifestValidationError,
    );
    assert.equal(readFileSync(manifestPath, "utf8"), originalRaw);

    assert.throws(
      () =>
        writeManifest(manifestPath, {
          network: "testnet",
          contracts: {
            "upto-session": { contractId: "not-a-valid-contract-id" },
          },
        }),
      ManifestValidationError,
    );
    assert.equal(readFileSync(manifestPath, "utf8"), originalRaw);
    assert.deepEqual(readdirSync(dir), ["testnet.json"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("existing valid manifest survives secret check failure and never leaks secret value", () => {
  const dir = makeTempDir();
  try {
    const manifestPath = join(dir, "testnet.json");
    writeManifest(manifestPath, baseManifest());
    const originalRaw = readFileSync(manifestPath, "utf8");

    const cases = [
      { label: "seed", payload: { ...baseManifest(), deployer: SYNTHETIC_SEED }, secret: SYNTHETIC_SEED },
      { label: "mnemonic", payload: { ...baseManifest(), note: SYNTHETIC_MNEMONIC }, secret: SYNTHETIC_MNEMONIC },
      { label: "private-key-hex", payload: { ...baseManifest(), signerKey: "f".repeat(64) }, secret: "f".repeat(64) },
      { label: "xdr-envelope", payload: { ...baseManifest(), envelope: "A".repeat(96) }, secret: "A".repeat(96) },
    ];

    for (const testCase of cases) {
      assert.throws(
        () => writeManifest(manifestPath, testCase.payload),
        (err) => {
          assert.ok(err instanceof ManifestSecretError, `expected ManifestSecretError for ${testCase.label}`);
          assert.ok(!err.message.includes(testCase.secret), "error message must not leak secret value");
          return true;
        },
      );
      assert.equal(readFileSync(manifestPath, "utf8"), originalRaw);
    }

    const prevSecret = process.env.LUMENBAZAAR_TEST_SECRET;
    process.env.LUMENBAZAAR_TEST_SECRET = "synthetic-super-secret-token-value";
    try {
      assert.throws(
        () =>
          writeManifest(manifestPath, {
            ...baseManifest(),
            note: "prefix synthetic-super-secret-token-value suffix",
          }),
        (err) =>
          err instanceof ManifestSecretError &&
          !err.message.includes("synthetic-super-secret-token-value"),
      );
      assert.equal(readFileSync(manifestPath, "utf8"), originalRaw);
    } finally {
      if (prevSecret === undefined) delete process.env.LUMENBAZAAR_TEST_SECRET;
      else process.env.LUMENBAZAAR_TEST_SECRET = prevSecret;
    }

    assert.deepEqual(readdirSync(dir), ["testnet.json"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("existing valid manifest survives interrupted write, fsync failure, and rename failure", () => {
  const dir = makeTempDir();
  try {
    const manifestPath = join(dir, "testnet.json");
    const unrelatedPath = join(dir, "sibling.json");
    writeManifest(manifestPath, baseManifest());
    writeFileSync(unrelatedPath, '{"unrelated":true}\n', "utf8");
    const originalRaw = readFileSync(manifestPath, "utf8");

    // Simulated mid-write crash on temp file.
    assert.throws(
      () =>
        writeManifest(manifestPath, baseManifest(), {
          fsOps: {
            ...defaultFsOps,
            writeSync: (fd, buf, offset, length) => {
              if (Buffer.isBuffer(buf)) {
                throw new Error("Simulated disk full during temp write");
              }
              return defaultFsOps.writeSync(fd, buf, offset, length);
            },
          },
        }),
      /Simulated disk full/,
    );
    assert.equal(readFileSync(manifestPath, "utf8"), originalRaw);
    assert.equal(readFileSync(unrelatedPath, "utf8"), '{"unrelated":true}\n');
    assert.deepEqual(readdirSync(dir).sort(), ["sibling.json", "testnet.json"]);

    // Simulated fsync failure.
    assert.throws(
      () =>
        writeManifest(manifestPath, baseManifest(), {
          fsOps: {
            ...defaultFsOps,
            fsyncSync: () => {
              throw new Error("Simulated fsync I/O error");
            },
          },
        }),
      /Simulated fsync I\/O error/,
    );
    assert.equal(readFileSync(manifestPath, "utf8"), originalRaw);
    assert.deepEqual(readdirSync(dir).sort(), ["sibling.json", "testnet.json"]);

    // Simulated rename failure.
    assert.throws(
      () =>
        writeManifest(manifestPath, baseManifest(), {
          platform: "linux",
          fsOps: {
            ...defaultFsOps,
            renameSync: () => {
              const err = new Error("Simulated rename failure");
              err.code = "EIO";
              throw err;
            },
          },
        }),
      /Simulated rename failure/,
    );
    assert.equal(readFileSync(manifestPath, "utf8"), originalRaw);
    assert.deepEqual(readdirSync(dir).sort(), ["sibling.json", "testnet.json"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("concurrent write fails explicitly when lock file exists", () => {
  const dir = makeTempDir();
  try {
    const manifestPath = join(dir, "testnet.json");
    writeManifest(manifestPath, baseManifest());
    const originalRaw = readFileSync(manifestPath, "utf8");

    const lockPath = `${manifestPath}.lock`;
    writeFileSync(lockPath, "99999\n", "utf8");

    assert.throws(
      () => writeManifest(manifestPath, baseManifest()),
      (err) => err instanceof ManifestConcurrencyError && /Concurrent manifest write/.test(err.message),
    );
    assert.equal(readFileSync(manifestPath, "utf8"), originalRaw);
    // Lock owned by another writer must not be deleted by the rejected writer.
    assert.equal(existsSync(lockPath), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("stale write fails explicitly when manifest changed after snapshot", () => {
  const dir = makeTempDir();
  try {
    const manifestPath = join(dir, "testnet.json");
    writeManifest(manifestPath, baseManifest());

    const { manifest: staleCopy, snapshot: staleSnapshot } = readManifestWithSnapshot(manifestPath);

    // Another writer updates the manifest first.
    writeManifest(manifestPath, {
      ...baseManifest(),
      contracts: {
        ...baseManifest().contracts,
        "test-token": {
          name: "test-token",
          contractId: SECOND_CONTRACT_ID,
          wasmHash: VALID_HASH,
        },
      },
    });
    const latestRaw = readFileSync(manifestPath, "utf8");

    // Stale writer attempts to overwrite using the old snapshot.
    assert.throws(
      () => writeManifest(manifestPath, staleCopy, { expectedSnapshot: staleSnapshot }),
      (err) => err instanceof ManifestStaleWriteError && /Stale manifest write/.test(err.message),
    );
    assert.equal(readFileSync(manifestPath, "utf8"), latestRaw);

    // mergeContracts also fails explicitly when given a stale snapshot.
    assert.throws(
      () =>
        mergeContracts(
          manifestPath,
          [{ name: "upto-session", contractId: VALID_CONTRACT_ID }],
          { expectedSnapshot: staleSnapshot },
        ),
      ManifestStaleWriteError,
    );
    assert.equal(readFileSync(manifestPath, "utf8"), latestRaw);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("stale write fails when file is created concurrently after non-existent snapshot", () => {
  const dir = makeTempDir();
  try {
    const manifestPath = join(dir, "testnet.json");
    const missingSnapshot = snapshotFile(manifestPath);
    assert.equal(missingSnapshot.exists, false);

    writeManifest(manifestPath, baseManifest());
    const latestRaw = readFileSync(manifestPath, "utf8");

    assert.throws(
      () => writeManifest(manifestPath, baseManifest(), { expectedSnapshot: missingSnapshot }),
      ManifestStaleWriteError,
    );
    assert.equal(readFileSync(manifestPath, "utf8"), latestRaw);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("paths with spaces work for create, update, and merge", () => {
  const dir = makeTempDir("manifest space test ");
  try {
    const spacedDir = join(dir, "nested folder with spaces", "sub dir");
    const manifestPath = join(spacedDir, "testnet manifest v1.json");

    writeManifest(manifestPath, baseManifest());
    assert.equal(readManifest(manifestPath).contracts["upto-session"].contractId, VALID_CONTRACT_ID);

    mergeContracts(manifestPath, [
      {
        name: "test-token",
        contractId: SECOND_CONTRACT_ID,
        wasmHash: VALID_HASH,
      },
    ]);

    const updated = readManifest(manifestPath);
    assert.equal(updated.contracts["upto-session"].contractId, VALID_CONTRACT_ID);
    assert.equal(updated.contracts["test-token"].contractId, SECOND_CONTRACT_ID);
    assert.deepEqual(readdirSync(spacedDir), ["testnet manifest v1.json"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Linux and Windows replacement behaviors handle rename semantics properly", () => {
  const dir = makeTempDir();
  try {
    const targetPath = join(dir, "testnet.json");
    writeJsonAtomic(targetPath, { version: 1 });

    // Linux: single rename call, does not retry EPERM.
    let linuxAttempts = 0;
    assert.throws(
      () =>
        atomicReplaceFile(join(dir, "missing.tmp"), targetPath, {
          platform: "linux",
          maxRetries: 3,
          fsOps: {
            ...defaultFsOps,
            renameSync: () => {
              linuxAttempts += 1;
              const err = new Error("EPERM");
              err.code = "EPERM";
              throw err;
            },
          },
        }),
      /EPERM/,
    );
    assert.equal(linuxAttempts, 1);

    // Windows: retries transient EPERM/EBUSY and succeeds on third attempt.
    let winAttempts = 0;
    const result = writeManifest(
      targetPath,
      {
        ...baseManifest(),
        contracts: {
          "upto-session": {
            name: "upto-session",
            contractId: SECOND_CONTRACT_ID,
          },
        },
      },
      {
        platform: "win32",
        maxRetries: 3,
        fsOps: {
          ...defaultFsOps,
          renameSync: (from, to) => {
            winAttempts += 1;
            if (winAttempts < 3) {
              const err = new Error("Transient Windows lock");
              err.code = winAttempts === 1 ? "EPERM" : "EBUSY";
              throw err;
            }
            return defaultFsOps.renameSync(from, to);
          },
        },
      },
    );
    assert.equal(winAttempts, 3);
    assert.ok(result.sha256.length === 64);
    assert.equal(readManifest(targetPath).contracts["upto-session"].contractId, SECOND_CONTRACT_ID);

    // Windows: persistent EACCES preserves existing manifest and cleans temp/lock files.
    const preservedRaw = readFileSync(targetPath, "utf8");
    let failedWinAttempts = 0;
    assert.throws(
      () =>
        writeManifest(targetPath, baseManifest(), {
          platform: "win32",
          maxRetries: 3,
          fsOps: {
            ...defaultFsOps,
            renameSync: () => {
              failedWinAttempts += 1;
              const err = new Error("Persistent Windows EACCES");
              err.code = "EACCES";
              throw err;
            },
          },
        }),
      /Persistent Windows EACCES/,
    );
    assert.equal(failedWinAttempts, 3);
    assert.equal(readFileSync(targetPath, "utf8"), preservedRaw);
    assert.deepEqual(readdirSync(dir), ["testnet.json"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("refuses to overwrite a directory path", () => {
  const dir = makeTempDir();
  try {
    assert.throws(() => writeManifest(dir, baseManifest()), ManifestValidationError);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
