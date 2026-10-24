// Synthetic, offline fixtures for the binding's transaction evidence helpers.
// No keys are generated or stored: transactions are built from a synthetic
// public account and the mock signer returns the envelope unchanged.
const SOURCE_ACCOUNT_BYTE = 0x11;

/** Hex hash of a transaction; the SDK returns a Uint8Array, not a Buffer. */
export function transactionHashHex(transaction) {
  return Buffer.from(transaction.hash()).toString("hex");
}

/** Builds an unsigned synthetic transaction for `networkPassphrase`. */
export function syntheticTransaction(sdk, networkPassphrase, sequence = "100") {
  const source = sdk.StrKey.encodeEd25519PublicKey(Buffer.alloc(32, SOURCE_ACCOUNT_BYTE));
  return new sdk.TransactionBuilder(new sdk.Account(source, sequence), {
    fee: "100",
    networkPassphrase,
  })
    .addOperation(sdk.Operation.bumpSequence({ bumpTo: String(BigInt(sequence) + 10n) }))
    .setTimeout(0)
    .build();
}

/** Mimics a simulated, generated `AssembledTransaction`. */
export function fakeAssembled(sdk, networkPassphrase, overrides = {}) {
  return {
    built: syntheticTransaction(sdk, networkPassphrase),
    isReadCall: false,
    needsNonInvokerSigningBy: () => [],
    options: {
      networkPassphrase,
      // Stand-in for the generated decoder; SDK 17 XDR values expose their arm as `type`.
      parseResultXdr: (value) => ({ decodedType: value.type }),
    },
    ...overrides,
  };
}

/** A generated-client stand-in exposing the four write flows. */
export function fakeClient(sdk, networkPassphrase, overrides = {}) {
  const calls = [];
  const method = (name) => async (args) => {
    calls.push({ name, args });
    return fakeAssembled(sdk, networkPassphrase, overrides);
  };
  return {
    calls,
    create_session: method("create_session"),
    settle: method("settle"),
    cancel: method("cancel"),
    extend_ttl: method("extend_ttl"),
  };
}

/** Records what the library hands to the signer and returns it unchanged. */
export function recordingSigner(transform = (xdr) => ({ signedTxXdr: xdr })) {
  const calls = [];
  return {
    calls,
    async signTransaction(...args) {
      calls.push(args);
      return transform(...args);
    },
  };
}

/**
 * RPC mock. `send` is the sendTransaction response (or a function of the
 * transaction); `polls` is the queue of getTransaction responses (the last one
 * repeats). Hash fields default to the real hash of the submitted envelope.
 */
export function mockRpc({ send = {}, polls = [] } = {}) {
  const state = { sent: [], polled: [] };
  let hash;
  return {
    state,
    async sendTransaction(transaction) {
      state.sent.push(transaction);
      hash = transactionHashHex(transaction);
      const response = typeof send === "function" ? send(transaction) : send;
      if (response instanceof Error) {
        throw response;
      }
      return { status: "PENDING", hash, latestLedger: 900, latestLedgerCloseTime: 1_790_000_000, ...response };
    },
    async getTransaction(requested) {
      state.polled.push(requested);
      const next = polls.length > 1 ? polls.shift() : polls[0];
      const response = typeof next === "function" ? next(hash) : next;
      if (response instanceof Error) {
        throw response;
      }
      return { txHash: hash, latestLedger: 901, latestLedgerCloseTime: 1_790_000_005, ...response };
    },
  };
}

export function successPoll(sdk, returnValue = sdk.xdr.ScVal.scvVoid()) {
  return { status: "SUCCESS", ledger: 4_541_400, createdAt: 1_790_000_010, returnValue };
}

export function failedPoll(sdk) {
  return {
    status: "FAILED",
    ledger: 4_541_401,
    createdAt: 1_790_000_015,
    resultXdr: sdk.xdr.TransactionResult.fromXDR(
      // txFailed with fee 100 and no operation results.
      "AAAAAAAAAGT/////AAAAAAAAAAA=",
      "base64",
    ),
  };
}

/** Deterministic clock and sleep: each sleep advances the clock. */
export function fakeTime() {
  let current = 0;
  return {
    now: () => current,
    sleep: async (ms) => {
      current += ms;
    },
  };
}
