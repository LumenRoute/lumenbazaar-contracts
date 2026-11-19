import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  DEFAULT_RPC_RETRY_POLICY,
  KNOWN_NETWORK_PASSPHRASES,
  SUPPORTED_NETWORKS,
  classifyRpcError,
  computeNetworkId,
  deployContract,
  findContractId,
  formatCommand,
  getContractEntry,
  invokeContract,
  mergeContracts,
  networkArgs,
  parseNetworkPassphraseFromCli,
  quoteArg,
  readManifest,
  resolveExpectedNetworkIdentity,
  resolveRpcRetryPolicy,
  runStellar,
  runStellarTransaction,
  submitTransactionWithRetry,
  validateNetwork,
  verifyNetworkPassphrase,
  verifyNetworkPassphraseSync,
  withBoundedRetry,
  writeManifest,
} from "./stellar-cli.mjs";

test("command arguments are asserted as distinct arrays without shell interpolation", () => {
  const recorded = [];
  const mockExec = (cmd, args, opts) => {
    recorded.push({ cmd, args, opts });
    return "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM";
  };

  const wasmPath = "path with spaces/target/release/contract.wasm";
  const source = "GCYEX7MPJL64ZJ7ABZSPRC7YEBSI7OMC62FFEVFHCZFREBOYJPQDUCYJ";

  deployContract({
    name: "upto-session",
    wasm: wasmPath,
    alias: "alias-with-spaces and special chars",
    source,
    network: "testnet",
    exec: mockExec,
  });

  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].cmd, "stellar");
  assert.deepEqual(recorded[0].args, [
    "contract",
    "deploy",
    "--wasm",
    wasmPath,
    "--source-account",
    source,
    "--network",
    "testnet",
    "--alias",
    "alias-with-spaces and special chars",
  ]);

  // Argument containing space must be intact as single array element
  assert.equal(recorded[0].args[3], wasmPath);
});

test("invokeContract constructs exact arguments array with parameters", () => {
  const recorded = [];
  const mockExec = (cmd, args) => {
    recorded.push({ cmd, args });
    return "success";
  };

  invokeContract({
    contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
    source: "local-deployer",
    network: "local",
    args: ["initialize", "--admin", "local-deployer", "--cap", "100"],
    exec: mockExec,
  });

  assert.equal(recorded.length, 1);
  assert.deepEqual(recorded[0].args, [
    "contract",
    "invoke",
    "--id",
    "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
    "--source-account",
    "local-deployer",
    "--network",
    "local",
    "--",
    "initialize",
    "--admin",
    "local-deployer",
    "--cap",
    "100",
  ]);
});

test("nonzero exits produce actionable distinct failures preserving stderr", () => {
  const mockFailExec = () => {
    const error = new Error("Command failed: stellar contract deploy");
    error.status = 127;
    error.stderr = "error: transaction submission failed: host error";
    error.stdout = "tx_id: 123";
    throw error;
  };

  assert.throws(
    () => runStellar(["contract", "deploy"], { exec: mockFailExec }),
    (err) => {
      assert.equal(err.status, 127);
      assert.equal(err.stderr, "error: transaction submission failed: host error");
      assert.match(err.message, /exit code 127/);
      assert.match(err.message, /transaction submission failed: host error/);
      return true;
    },
  );
});

test("malformed deployment output without contract ID fails distinctly", () => {
  const mockExec = () => "Transaction processed successfully but no ID printed\nRandom info";

  assert.throws(
    () =>
      deployContract({
        name: "test-token",
        wasm: "token.wasm",
        alias: "token-alias",
        source: "deployer",
        network: "local",
        exec: mockExec,
      }),
    /Failed to extract valid contract ID from deployment output for test-token/,
  );
});

test("findContractId correctly parses last valid C-address from multi-line output", () => {
  const output = `
    Simulating transaction...
    Result: Ok
    CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM
    Done!
  `;
  assert.equal(
    findContractId(output),
    "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
  );
  assert.equal(findContractId(""), undefined);
  assert.equal(findContractId("No contract here"), undefined);
});

test("unsupported networks fail closed with actionable error", () => {
  assert.throws(
    () => validateNetwork("unknown-net"),
    /Unsupported network "unknown-net"/,
  );
  assert.throws(() => validateNetwork(""), /Network must be a non-empty string/);

  for (const net of SUPPORTED_NETWORKS) {
    assert.equal(validateNetwork(net), net);
  }

  // NetworkArgs validation
  const originalEnv = process.env.STELLAR_NETWORK;
  try {
    delete process.env.STELLAR_NETWORK;
    assert.throws(() => networkArgs("invalid_network"), /Unsupported network/);
    assert.deepEqual(networkArgs("testnet"), ["--network", "testnet"]);

    process.env.STELLAR_NETWORK = "bad-env-network";
    assert.throws(() => networkArgs("testnet"), /Unsupported network "bad-env-network"/);
  } finally {
    if (originalEnv !== undefined) {
      process.env.STELLAR_NETWORK = originalEnv;
    } else {
      delete process.env.STELLAR_NETWORK;
    }
  }
});

test("readManifest produces distinct errors on malformed JSON and structure", () => {
  const dir = mkdtempSync(join(tmpdir(), "stellar-cli-test-"));
  try {
    const missingPath = join(dir, "missing.json");
    assert.deepEqual(readManifest(missingPath), { contracts: {} });

    const malformedPath = join(dir, "malformed.json");
    writeFileSync(malformedPath, "{ invalid json", "utf8");
    assert.throws(
      () => readManifest(malformedPath),
      /Malformed JSON in deployment manifest at/,
    );

    const arrayPath = join(dir, "array.json");
    writeFileSync(arrayPath, "[]", "utf8");
    assert.throws(
      () => readManifest(arrayPath),
      /expected a JSON object/,
    );

    const badContractsPath = join(dir, "bad-contracts.json");
    writeFileSync(badContractsPath, JSON.stringify({ contracts: "not-an-object" }), "utf8");
    assert.throws(
      () => readManifest(badContractsPath),
      /"contracts" field must be an object/,
    );

    const validPath = join(dir, "valid.json");
    const manifest = {
      contracts: {
        "upto-session": {
          contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
        },
      },
    };
    writeFileSync(validPath, JSON.stringify(manifest), "utf8");
    const read = readManifest(validPath);
    assert.deepEqual(read, manifest);

    // Test getContractEntry
    const entry = getContractEntry(read, "upto-session");
    assert.equal(entry.contractId, "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM");

    assert.throws(
      () => getContractEntry(read, "missing-contract"),
      /Contract "missing-contract" not found in manifest/,
    );

    assert.throws(
      () =>
        getContractEntry(
          { contracts: { invalid: { contractId: "not-a-valid-id" } } },
          "invalid",
        ),
      /missing a valid contractId/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("dry-run mode performs no process execution or filesystem mutation", () => {
  let executed = false;
  const mockExec = () => {
    executed = true;
    return "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM";
  };

  const output = runStellar(["contract", "build"], { dryRun: true, exec: mockExec });
  assert.equal(output, "");
  assert.equal(executed, false);

  const deployment = deployContract({
    name: "upto-session",
    wasm: "target/wasm.wasm",
    alias: "alias",
    source: "deployer",
    network: "local",
    dryRun: true,
    exec: mockExec,
  });
  assert.equal(deployment.contractId, "dry-run");
  assert.equal(executed, false);

  // Filesystem mutation check during dry run
  const dir = mkdtempSync(join(tmpdir(), "dryrun-test-"));
  try {
    const targetPath = join(dir, "manifest.json");
    writeManifest(targetPath, { contracts: {} }, { dryRun: true });
    assert.equal(existsSync(targetPath), false);

    mergeContracts(targetPath, [deployment], { dryRun: true });
    assert.equal(existsSync(targetPath), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("formatCommand correctly quotes paths containing spaces for dry-run inspection", () => {
  const formatted = formatCommand("stellar", [
    "contract",
    "deploy",
    "--wasm",
    "C:/Path With Spaces/my contract.wasm",
    "--network",
    "testnet",
  ]);
  assert.equal(
    formatted,
    'stellar contract deploy --wasm "C:/Path With Spaces/my contract.wasm" --network testnet',
  );

  assert.equal(quoteArg("normal_arg-123.wasm"), "normal_arg-123.wasm");
  assert.equal(quoteArg("spaced arg"), '"spaced arg"');
});

// ── Issue #143: Network passphrase verification before transaction signing ──

test("known testnet and local identities pass pre-signing network passphrase verification", async () => {
  const testnetIdentity = verifyNetworkPassphraseSync({
    network: "testnet",
    actualPassphrase: KNOWN_NETWORK_PASSPHRASES.testnet,
  });
  assert.equal(testnetIdentity.network, "testnet");
  assert.equal(testnetIdentity.passphrase, "Test SDF Network ; September 2015");
  assert.equal(
    testnetIdentity.networkId,
    computeNetworkId("Test SDF Network ; September 2015"),
  );
  assert.equal(testnetIdentity.isCustom, false);

  const localIdentity = verifyNetworkPassphraseSync({
    network: "local",
    resolveNetwork: () => KNOWN_NETWORK_PASSPHRASES.local,
  });
  assert.equal(localIdentity.network, "local");
  assert.equal(localIdentity.passphrase, "Standalone Network ; February 2017");
  assert.equal(
    localIdentity.networkId,
    computeNetworkId("Standalone Network ; February 2017"),
  );
  assert.equal(localIdentity.isCustom, false);

  // Async verification via RPC getNetwork returns matching identity
  const rpcIdentity = await verifyNetworkPassphrase({
    network: "testnet",
    rpcUrl: "https://rpc.example.invalid",
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        jsonrpc: "2.0",
        id: 1,
        result: { passphrase: KNOWN_NETWORK_PASSPHRASES.testnet, protocolVersion: 22 },
      }),
    }),
  });
  assert.equal(rpcIdentity.passphrase, KNOWN_NETWORK_PASSPHRASES.testnet);
  assert.equal(rpcIdentity.networkId, testnetIdentity.networkId);

  // CLI output parser supports both JSON and key-value formats
  assert.equal(
    parseNetworkPassphraseFromCli(
      JSON.stringify({ passphrase: KNOWN_NETWORK_PASSPHRASES.local }),
      "local",
    ),
    KNOWN_NETWORK_PASSPHRASES.local,
  );
  assert.equal(
    parseNetworkPassphraseFromCli("Passphrase: Test SDF Network ; September 2015\n", "testnet"),
    KNOWN_NETWORK_PASSPHRASES.testnet,
  );
});

test("custom networks require an explicit expected passphrase", async () => {
  assert.throws(
    () => resolveExpectedNetworkIdentity("private-devnet", { env: {} }),
    (err) => {
      assert.equal(err.code, "MISSING_EXPECTED_NETWORK_PASSPHRASE");
      assert.match(err.message, /requires an explicit expected passphrase/);
      return true;
    },
  );

  const customPassphrase = "Synthetic Custom Network ; 2026";
  const resolved = await verifyNetworkPassphrase({
    network: "private-devnet",
    expectedPassphrase: customPassphrase,
    actualPassphrase: customPassphrase,
    env: {},
  });
  assert.equal(resolved.isCustom, true);
  assert.equal(resolved.passphrase, customPassphrase);
  assert.equal(resolved.networkId, computeNetworkId(customPassphrase));

  await assert.rejects(
    () =>
      verifyNetworkPassphrase({
        network: "private-devnet",
        expectedPassphrase: customPassphrase,
        actualPassphrase: KNOWN_NETWORK_PASSPHRASES.testnet,
        env: {},
      }),
    (err) => err.code === "NETWORK_PASSPHRASE_MISMATCH",
  );
});

test("network passphrase mismatch fails before account authorization, signing, or submission", async () => {
  // Even when the RPC hostname looks like testnet, a mismatched passphrase from getNetwork fails closed.
  await assert.rejects(
    () =>
      verifyNetworkPassphrase({
        network: "testnet",
        rpcUrl: "https://soroban-testnet.stellar.org",
        fetchImpl: async () => ({
          ok: true,
          json: async () => ({
            jsonrpc: "2.0",
            id: 1,
            result: { passphrase: KNOWN_NETWORK_PASSPHRASES.mainnet },
          }),
        }),
      }),
    (err) => {
      assert.equal(err.code, "NETWORK_PASSPHRASE_MISMATCH");
      assert.match(err.message, /Aborting before transaction signing/);
      return true;
    },
  );

  // deployContract, invokeContract, and runStellarTransaction must NOT invoke CLI on mismatch.
  let cliInvoked = false;
  const forbiddenExec = () => {
    cliInvoked = true;
    return "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM";
  };
  const forbiddenSpawn = () => {
    cliInvoked = true;
    return { status: 0, stdout: "", stderr: "" };
  };

  assert.throws(
    () =>
      deployContract({
        name: "upto-session",
        wasm: "target/upto.wasm",
        alias: "upto-testnet",
        source: "testnet-deployer",
        network: "testnet",
        actualPassphrase: KNOWN_NETWORK_PASSPHRASES.local,
        exec: forbiddenExec,
      }),
    (err) => err.code === "NETWORK_PASSPHRASE_MISMATCH",
  );
  assert.equal(cliInvoked, false);

  assert.throws(
    () =>
      invokeContract({
        contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
        source: "testnet-deployer",
        network: "testnet",
        args: ["initialize"],
        actualPassphrase: KNOWN_NETWORK_PASSPHRASES.mainnet,
        exec: forbiddenExec,
      }),
    (err) => err.code === "NETWORK_PASSPHRASE_MISMATCH",
  );
  assert.equal(cliInvoked, false);

  assert.throws(
    () =>
      runStellarTransaction(["contract", "upload", "--network", "testnet", "--source-account", "S-SYNTHETIC-SECRET"], {
        actualPassphrase: KNOWN_NETWORK_PASSPHRASES.mainnet,
        execute: forbiddenSpawn,
      }),
    (err) => {
      assert.equal(err.code, "NETWORK_PASSPHRASE_MISMATCH");
      assert.ok(!err.message.includes("S-SYNTHETIC-SECRET"));
      return true;
    },
  );
  assert.equal(cliInvoked, false);
});

// ── Issue #142: Bounded RPC retries, timeouts, and submission identity verification ──

test("retryable and terminal RPC errors are classified separately", () => {
  const retryableCases = [
    Object.assign(new Error("connect ETIMEDOUT"), { code: "ETIMEDOUT" }),
    Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }),
    Object.assign(new Error("request aborted"), { name: "AbortError" }),
    Object.assign(new Error("getNetwork returned HTTP 429."), { httpStatus: 429 }),
    Object.assign(new Error("simulateTransaction returned HTTP 503."), { httpStatus: 503 }),
    new Error("RPC returned TRY_AGAIN_LATER"),
  ];
  for (const err of retryableCases) {
    const classified = classifyRpcError(err);
    assert.equal(classified.retryable, true, `expected retryable for: ${err.message}`);
  }

  const terminalCases = [
    new Error("HostError: Error(Contract, #8)"),
    new Error("HostError: Error(Auth, InvalidAction)"),
    new Error("transaction failed with tx_bad_seq"),
    new Error("Cannot assemble a transaction from a failed simulation: InvalidAction"),
    Object.assign(new Error("simulateTransaction returned HTTP 400."), { httpStatus: 400 }),
    Object.assign(new Error("passphrase mismatch"), { code: "NETWORK_PASSPHRASE_MISMATCH" }),
    Object.assign(new Error("tx identity mismatch"), { code: "TRANSACTION_IDENTITY_MISMATCH" }),
    new Error("unrecognized local error"),
  ];
  for (const err of terminalCases) {
    const classified = classifyRpcError(err);
    assert.equal(classified.retryable, false, `expected terminal for: ${err.message}`);
  }
});

test("withBoundedRetry retries transient errors with bounded backoff and stops immediately on deterministic errors", async () => {
  let nowMs = 1_000;
  const delays = [];
  let attempts = 0;

  const value = await withBoundedRetry(
    async ({ attempt }) => {
      attempts = attempt;
      if (attempt < 3) {
        const err = new Error("getLatestLedger returned HTTP 503.");
        err.httpStatus = 503;
        throw err;
      }
      return "ok";
    },
    {
      maxAttempts: 4,
      attemptTimeoutMs: 5_000,
      totalTimeoutMs: 30_000,
      initialDelayMs: 100,
      maxDelayMs: 500,
      backoffFactor: 2,
      now: () => nowMs,
      sleep: async (ms) => {
        delays.push(ms);
        nowMs += ms;
      },
    },
  );
  assert.equal(value, "ok");
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [100, 200]);

  // Deterministic contract error must fail after 1 attempt with zero sleeps.
  let contractAttempts = 0;
  const contractDelays = [];
  await assert.rejects(
    () =>
      withBoundedRetry(
        async () => {
          contractAttempts += 1;
          throw new Error("HostError: Error(Contract, #6)");
        },
        {
          maxAttempts: 4,
          initialDelayMs: 100,
          sleep: async (ms) => {
            contractDelays.push(ms);
          },
        },
      ),
    /Error\(Contract, #6\)/,
  );
  assert.equal(contractAttempts, 1);
  assert.deepEqual(contractDelays, []);
});

test("withBoundedRetry enforces maximum attempts and total duration bounds", async () => {
  let nowMs = 0;
  const delays = [];
  let attempts = 0;

  await assert.rejects(
    () =>
      withBoundedRetry(
        async () => {
          attempts += 1;
          nowMs += 100;
          const err = new Error("socket hang up");
          err.code = "ECONNRESET";
          throw err;
        },
        {
          maxAttempts: 3,
          attemptTimeoutMs: 1_000,
          totalTimeoutMs: 10_000,
          initialDelayMs: 200,
          maxDelayMs: 1_000,
          backoffFactor: 2,
          now: () => nowMs,
          sleep: async (ms) => {
            delays.push(ms);
            nowMs += ms;
          },
        },
      ),
    (err) => {
      assert.equal(err.code, "RPC_RETRY_EXHAUSTED");
      assert.equal(err.attempts, 3);
      return true;
    },
  );
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [200, 400]);

  // Total deadline stops retries even when maxAttempts is higher.
  let clock = 0;
  let deadlineAttempts = 0;
  await assert.rejects(
    () =>
      withBoundedRetry(
        async () => {
          deadlineAttempts += 1;
          clock += 400;
          const err = new Error("connect ETIMEDOUT");
          err.code = "ETIMEDOUT";
          throw err;
        },
        {
          maxAttempts: 10,
          attemptTimeoutMs: 500,
          totalTimeoutMs: 600,
          initialDelayMs: 300,
          maxDelayMs: 1_000,
          now: () => clock,
          sleep: async (ms) => {
            clock += ms;
          },
        },
      ),
    (err) => {
      assert.equal(err.code, "RPC_TOTAL_TIMEOUT_EXCEEDED");
      assert.equal(err.attempts, 1);
      return true;
    },
  );
  assert.equal(deadlineAttempts, 1);

  // Policy resolver enforces positive bounds
  assert.equal(resolveRpcRetryPolicy({}).maxAttempts, DEFAULT_RPC_RETRY_POLICY.maxAttempts);
  assert.throws(() => resolveRpcRetryPolicy({ maxAttempts: 0 }), /maxAttempts must be an integer >= 1/);
});

test("submitTransactionWithRetry verifies transaction identity before sending and resending", async () => {
  const txHash = "a".repeat(64);
  const otherHash = "b".repeat(64);
  const signedXdr = "AAAAAgAAAABsyntheticSignedEnvelopeBase64==";

  // Hash mismatch before first attempt must fail without calling sendTransaction.
  let sentCount = 0;
  await assert.rejects(
    () =>
      submitTransactionWithRetry({
        signedXdr,
        expectedTransactionHash: txHash,
        computeTransactionHash: () => otherHash,
        sendTransaction: async () => {
          sentCount += 1;
          return { transactionHash: otherHash };
        },
      }),
    (err) => err.code === "TRANSACTION_IDENTITY_MISMATCH",
  );
  assert.equal(sentCount, 0);

  // Transient failure on attempt 1 checks transaction status on attempt 2; if already landed, does not resend.
  let sends = 0;
  let statusChecks = 0;
  const landed = await submitTransactionWithRetry({
    signedXdr,
    expectedTransactionHash: txHash,
    computeTransactionHash: () => txHash,
    checkTransactionStatus: async (hash) => {
      statusChecks += 1;
      assert.equal(hash, txHash);
      return { status: "SUCCESS", ledger: 12345 };
    },
    sendTransaction: async ({ transactionHash }) => {
      sends += 1;
      assert.equal(transactionHash, txHash);
      const err = new Error("sendTransaction returned HTTP 504.");
      err.httpStatus = 504;
      throw err;
    },
    retryPolicy: { maxAttempts: 3, initialDelayMs: 0, maxDelayMs: 0 },
  });
  assert.equal(sends, 1);
  assert.equal(statusChecks, 1);
  assert.equal(landed.alreadySubmitted, true);
  assert.equal(landed.status, "SUCCESS");
  assert.equal(landed.transactionHash, txHash);

  // Transient failure when status is NOT_FOUND retries the exact same transaction identity and succeeds.
  let retrySends = 0;
  const resent = await submitTransactionWithRetry({
    signedXdr,
    expectedTransactionHash: txHash,
    computeTransactionHash: () => txHash,
    checkTransactionStatus: async () => ({ status: "NOT_FOUND" }),
    sendTransaction: async ({ transactionHash }) => {
      retrySends += 1;
      if (retrySends === 1) {
        const err = new Error("read ECONNRESET");
        err.code = "ECONNRESET";
        throw err;
      }
      return { transactionHash, status: 0 };
    },
    retryPolicy: { maxAttempts: 3, initialDelayMs: 0, maxDelayMs: 0 },
  });
  assert.equal(retrySends, 2);
  assert.equal(resent.alreadySubmitted, false);
  assert.equal(resent.transactionHash, txHash);
});
