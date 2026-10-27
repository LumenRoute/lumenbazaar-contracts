// Backend-side verification of the Rust-generated encoding compatibility
// vectors in artifacts/backend-handoff/encoding-vectors.v<N>.json, plus the
// compatibility lock that makes every published version immutable.
//
// The verifier uses only the generated binding's encoding helpers and the
// Stellar SDK it re-exports. It never signs or submits transactions.
import { createHash } from "node:crypto";

export const VECTOR_SCHEMA = "lumenbazaar/encoding-vectors";
export const LOCK_FILE = "encoding-vectors.lock.json";
export const CHANGELOG_FILE = "encoding-vectors.CHANGELOG.md";
const VERSION_STATUSES = new Set(["current", "retained", "retired"]);

export function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function vectorFileName(version) {
  return `encoding-vectors.v${version}.json`;
}

/**
 * Checks the lock against the files on disk. `readFile(name)` returns a Buffer
 * or null when the file does not exist.
 */
export function verifyLock(lock, readFile) {
  const errors = [];
  if (!isRecord(lock) || !Number.isSafeInteger(lock.current) || lock.current < 1) {
    return ["lock: `current` must be a positive integer"];
  }
  if (!isRecord(lock.versions)) {
    return ["lock: `versions` must be an object keyed by version number"];
  }
  const changelog = readFile(CHANGELOG_FILE);
  const changelogHeadings = new Set(
    changelog === null
      ? []
      : changelog
          .toString("utf8")
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => /^## v\d+$/.test(line)),
  );
  if (changelog === null) {
    errors.push(`${CHANGELOG_FILE} is missing`);
  }

  const keys = Object.keys(lock.versions);
  for (let version = 1; version <= lock.current; version += 1) {
    if (!keys.includes(String(version))) {
      errors.push(`lock: version ${version} is missing; versions are append-only`);
    }
  }
  let currentCount = 0;
  for (const key of keys) {
    const version = Number(key);
    const entry = lock.versions[key];
    if (!/^[1-9][0-9]*$/.test(key) || version > lock.current) {
      errors.push(`lock: unexpected version key ${JSON.stringify(key)}`);
      continue;
    }
    if (!isRecord(entry)) {
      errors.push(`lock: version ${key} entry must be an object`);
      continue;
    }
    if (entry.file !== vectorFileName(version)) {
      errors.push(`lock: version ${key} must name ${vectorFileName(version)}`);
    }
    if (!/^[0-9a-f]{64}$/.test(entry.sha256 ?? "")) {
      errors.push(`lock: version ${key} sha256 must be 64 lowercase hex characters`);
    }
    if (!VERSION_STATUSES.has(entry.status)) {
      errors.push(`lock: version ${key} status must be one of ${[...VERSION_STATUSES].join(", ")}`);
    }
    if (entry.status === "current") {
      currentCount += 1;
      if (version !== lock.current) {
        errors.push(`lock: only version ${lock.current} may have status "current"`);
      }
    }
    if (!changelogHeadings.has(`## v${key}`)) {
      errors.push(`${CHANGELOG_FILE} has no "## v${key}" entry`);
    }
    const bytes = readFile(vectorFileName(version));
    if (bytes === null) {
      errors.push(`${vectorFileName(version)} is missing; published versions stay in the repository`);
      continue;
    }
    const actual = sha256Hex(bytes);
    if (actual !== entry.sha256) {
      errors.push(
        `${vectorFileName(version)} sha256 ${actual} does not match the lock (${entry.sha256}); ` +
          "published vectors are immutable: add a new version instead of editing this one",
      );
    }
    let parsed;
    try {
      parsed = JSON.parse(bytes.toString("utf8"));
    } catch {
      errors.push(`${vectorFileName(version)} is not valid JSON`);
      continue;
    }
    if (parsed.version !== version || parsed.schema !== VECTOR_SCHEMA) {
      errors.push(`${vectorFileName(version)} must declare schema ${VECTOR_SCHEMA} and version ${version}`);
    }
  }
  if (currentCount !== 1) {
    errors.push('lock: exactly one version must have status "current"');
  }
  return errors;
}

/**
 * Compares the lock on the PR base with the lock in the working tree. Every
 * version present on the base must be byte-for-byte unchanged (same file and
 * checksum); only its status may move from current to retained or retired.
 */
export function compareLocks(baseLock, headLock) {
  if (baseLock === null) {
    return [];
  }
  const errors = [];
  if (!isRecord(headLock?.versions) || !Number.isSafeInteger(headLock?.current)) {
    return ["lock: working-tree lock is malformed"];
  }
  if (headLock.current < baseLock.current) {
    errors.push(`lock: current version moved backwards from ${baseLock.current} to ${headLock.current}`);
  }
  for (const [key, baseEntry] of Object.entries(baseLock.versions ?? {})) {
    const headEntry = headLock.versions[key];
    if (!isRecord(headEntry)) {
      errors.push(`lock: version ${key} was removed; published versions are append-only`);
      continue;
    }
    if (headEntry.file !== baseEntry.file || headEntry.sha256 !== baseEntry.sha256) {
      errors.push(
        `lock: version ${key} changed (${baseEntry.sha256} -> ${headEntry.sha256}). ` +
          "Changing an existing vector or encoding rule requires a new version, a new " +
          "encoding-vectors.v<N>.json file and a changelog entry.",
      );
    }
    if (baseEntry.status === "retired" && headEntry.status !== "retired") {
      errors.push(`lock: retired version ${key} cannot be reactivated`);
    }
  }
  return errors;
}

/**
 * Verifies a parsed vector file against the TypeScript/backend encoding path.
 * `sdk` is the generated binding module (it re-exports @stellar/stellar-sdk).
 */
export function verifyVectors(vectors, sdk) {
  const errors = [];
  const check = (condition, message) => {
    if (!condition) {
      errors.push(message);
    }
  };
  const attempt = (label, fn) => {
    try {
      fn();
    } catch (error) {
      errors.push(`${label}: ${error.message}`);
    }
  };
  const accepts = (fn) => {
    try {
      fn();
      return true;
    } catch {
      return false;
    }
  };

  check(vectors?.schema === VECTOR_SCHEMA, `schema must be ${VECTOR_SCHEMA}`);
  check(Number.isSafeInteger(vectors?.version) && vectors.version >= 1, "version must be a positive integer");
  for (const section of [
    "networkPassphrases",
    "sessionIds",
    "usageCommitments",
    "addresses",
    "amounts",
    "resourceHashes",
    "sessionExpiry",
    "events",
  ]) {
    check(Array.isArray(vectors?.[section]) && vectors[section].length > 0, `${section} must be a non-empty array`);
  }
  check(
    Array.isArray(vectors?.usageReceipts?.valid) && Array.isArray(vectors?.usageReceipts?.invalid),
    "usageReceipts must contain valid and invalid arrays",
  );
  if (errors.length > 0) {
    return errors;
  }

  const { Address, StrKey, hash, nativeToScVal, xdr } = sdk;
  const baseSessionInput = (v) => ({
    contractId: v.contractId,
    buyer: v.buyer,
    seller: v.seller,
    asset: v.asset,
    maxAmount: v.maxAmount,
    expiresAtLedger: v.expiresAtLedger,
    resourceHash: v.resourceHashHex,
    sequence: v.sequence,
    idempotencyKey: v.idempotencyKeyHex,
  });

  for (const v of vectors.networkPassphrases) {
    const label = `networkPassphrases/${v.name}`;
    check(Buffer.from(v.passphrase, "utf8").toString("hex") === v.utf8Hex, `${label}: UTF-8 bytes differ`);
    check(Buffer.byteLength(v.passphrase, "utf8") === v.utf8Bytes, `${label}: UTF-8 length differs`);
    check(v.passphrase.length === v.utf16Units, `${label}: UTF-16 length differs`);
    check((v.passphrase.normalize("NFC") === v.passphrase) === v.nfc, `${label}: declared NFC flag is wrong`);
    if (v.networkIdHex !== undefined) {
      check(
        Buffer.from(hash(Buffer.from(v.passphrase, "utf8"))).toString("hex") === v.networkIdHex,
        `${label}: network ID differs`,
      );
    }
    const base = vectors.sessionIds[0];
    const tsAccepted = accepts(() =>
      sdk.validateSessionIdInput({ ...baseSessionInput(base), networkPassphrase: v.passphrase }),
    );
    check(tsAccepted === v.accepted, `${label}: TypeScript acceptance ${tsAccepted}, expected ${v.accepted}`);
  }

  for (const v of vectors.sessionIds) {
    const label = `sessionIds/${v.name}`;
    attempt(label, () => {
      const input = { ...baseSessionInput(v), networkId: v.networkIdHex };
      if (v.networkPassphrase !== undefined) {
        input.networkPassphrase = v.networkPassphrase;
      }
      check(sdk.deriveSessionIdPreimage(input).toString("hex") === v.preimageXdrHex, `${label}: preimage differs`);
      check(sdk.deriveSessionId(input) === v.sessionIdHex, `${label}: session ID differs`);
      check(sha256Hex(Buffer.from(v.preimageXdrHex, "hex")) === v.sessionIdHex, `${label}: digest differs`);
    });
  }

  for (const v of vectors.usageCommitments) {
    const label = `usageCommitments/${v.name}`;
    attempt(label, () => {
      const preimage = usageCommitmentPreimage(sdk, v);
      check(preimage.toString("hex") === v.preimageXdrHex, `${label}: preimage differs`);
      check(sha256Hex(preimage) === v.usageHashHex, `${label}: usage hash differs`);
    });
  }

  for (const v of vectors.usageReceipts.valid) {
    const label = `usageReceipts/valid/${v.name}`;
    attempt(label, () => {
      const canonical = sdk.canonicalizeUsageReceipt(v.receipt);
      check(canonical === v.canonicalUtf8, `${label}: canonical encoding differs`);
      check(Buffer.byteLength(canonical, "utf8") === v.canonicalUtf8Bytes, `${label}: UTF-8 length differs`);
      check(sdk.hashUsageReceipt(v.receipt) === v.sha256, `${label}: measurement hash differs`);
      sdk.parseCanonicalUsageReceipt(v.canonicalUtf8);
    });
  }
  for (const v of vectors.usageReceipts.invalid) {
    check(
      !accepts(() => sdk.canonicalizeUsageReceipt(v.receipt)),
      `usageReceipts/invalid/${v.name}: TypeScript accepted a receipt expected to fail (${v.error})`,
    );
  }

  for (const v of vectors.addresses) {
    const label = `addresses/${v.name}`;
    const tsKind = StrKey.isValidEd25519PublicKey(v.strkey)
      ? "account"
      : StrKey.isValidContract(v.strkey)
        ? "contract"
        : null;
    check((tsKind !== null) === v.accepted, `${label}: TypeScript acceptance ${tsKind !== null}, expected ${v.accepted}`);
    if (v.accepted && tsKind !== null) {
      check(tsKind === v.kind, `${label}: kind ${tsKind}, expected ${v.kind}`);
      check(Address.fromString(v.strkey).toScVal().toXDR("hex") === v.scValXdrHex, `${label}: ScVal XDR differs`);
    }
    if (v.error === "unsupported_muxed_address") {
      check(StrKey.isValidMed25519PublicKey(v.strkey), `${label}: expected a well-formed muxed strkey`);
    }
  }

  const base = vectors.sessionIds[0];
  for (const v of vectors.amounts) {
    const label = `amounts/${v.name}`;
    if (v.encodable) {
      check(
        nativeToScVal(BigInt(v.decimal), { type: "i128" }).toXDR("hex") === v.scValXdrHex,
        `${label}: i128 ScVal XDR differs`,
      );
    }
    const tsAccepted = accepts(() =>
      sdk.validateSessionIdInput({ ...baseSessionInput(base), networkId: base.networkIdHex, maxAmount: v.decimal }),
    );
    const expected = v.encodable === true && v.createSessionAccepted === true;
    check(tsAccepted === expected, `${label}: TypeScript maxAmount acceptance ${tsAccepted}, expected ${expected}`);
    checkContractError(label, v, sdk, check);
  }

  for (const v of vectors.resourceHashes) {
    const label = `resourceHashes/${v.name}`;
    if (v.encodable) {
      check(
        xdr.ScVal.scvBytes(Buffer.from(v.hex, "hex")).toXDR("hex") === v.scValXdrHex,
        `${label}: bytes ScVal XDR differs`,
      );
    }
    const tsAccepted = accepts(() =>
      sdk.validateSessionIdInput({ ...baseSessionInput(base), networkId: base.networkIdHex, resourceHash: v.hex }),
    );
    check(tsAccepted === v.encodable, `${label}: TypeScript encodability ${tsAccepted}, expected ${v.encodable}`);
    checkContractError(label, v, sdk, check);
  }

  for (const v of vectors.sessionExpiry) {
    checkContractError(`sessionExpiry/${v.name}`, v, sdk, check);
  }

  for (const v of vectors.events) {
    const label = `events/${v.name}`;
    attempt(label, () => {
      const topics = v.topicsXdrHex.map((hex) => decodeTyped(sdk, xdr.ScVal.fromXDR(hex, "hex")));
      check(JSON.stringify(topics) === JSON.stringify(v.expected.topics), `${label}: decoded topics differ`);
      const data = xdr.ScVal.fromXDR(v.dataXdrHex, "hex");
      check(data.type === "scvMap", `${label}: event data must be a map`);
      const entries = (data.map ?? []).map((entry) => [
        String(sdk.scValToNative(entry.key)),
        decodeTyped(sdk, entry.val),
      ]);
      const keys = entries.map(([key]) => key);
      check(JSON.stringify(keys) === JSON.stringify([...keys].sort()), `${label}: data keys are not ascending`);
      check(
        JSON.stringify(Object.fromEntries(entries)) === JSON.stringify(sortKeys(v.expected.data)),
        `${label}: decoded data differs`,
      );
    });
  }

  return errors;
}

function checkContractError(label, vector, sdk, check) {
  if (vector.createSessionAccepted === false) {
    const { name, code } = vector.contractError ?? {};
    // `ContractError` is the CLI-generated code -> { message } map.
    check(
      typeof name === "string" && sdk.ContractError?.[code]?.message === name,
      `${label}: contract error ${name}=${code} is not in the binding's typed error map`,
    );
  } else if (vector.createSessionAccepted === true) {
    check(vector.contractError === undefined, `${label}: accepted vector must not carry an error`);
  }
}

function usageCommitmentPreimage(sdk, v) {
  const { Address, xdr } = sdk;
  const amount = BigInt(v.actualAmount);
  const domain = xdr.ScVal.scvVec([
    xdr.ScVal.scvBytes(Buffer.from("lumenbazaar/usage-commitment", "utf8")),
    xdr.ScVal.scvU32(sdk.INTERFACE_VERSION),
    xdr.ScVal.scvBytes(Buffer.from(v.networkIdHex, "hex")),
    Address.fromString(v.contractId).toScVal(),
  ]);
  const payload = xdr.ScVal.scvVec([
    xdr.ScVal.scvU32(v.receiptSchemaVersion),
    xdr.ScVal.scvBytes(Buffer.from(v.sessionIdHex, "hex")),
    xdr.ScVal.scvI128(
      new xdr.Int128Parts({
        hi: xdr.Int64.fromString((amount >> 64n).toString()),
        lo: xdr.Uint64.fromString((amount & 0xffff_ffff_ffff_ffffn).toString()),
      }),
    ),
    xdr.ScVal.scvBytes(Buffer.from(v.resourceHashHex, "hex")),
    xdr.ScVal.scvBytes(Buffer.from(v.measurementHashHex, "hex")),
  ]);
  return Buffer.from(
    xdr.ScVal.scvVec([
      xdr.ScVal.scvBytes(domain.toXDR()),
      xdr.ScVal.scvBytes(payload.toXDR()),
    ]).toXDR(),
  );
}

// Stellar SDK 17 XDR values expose their arm as `type`; values are read back
// through the SDK's own `scValToNative` decoder.
function decodeTyped(sdk, value) {
  const native = sdk.scValToNative(value);
  switch (value.type) {
    case "scvSymbol":
      return { type: "symbol", value: String(native) };
    case "scvBytes":
      return { type: "bytes", value: Buffer.from(native).toString("hex") };
    case "scvAddress":
      return { type: "address", value: sdk.Address.fromScVal(value).toString() };
    case "scvI128":
      return { type: "i128", value: native.toString() };
    case "scvU32":
      return { type: "u32", value: Number(native) };
    default:
      throw new Error(`unexpected ScVal type ${value.type}`);
  }
}

function sortKeys(object) {
  return Object.fromEntries(Object.keys(object).sort().map((key) => [key, object[key]]));
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
