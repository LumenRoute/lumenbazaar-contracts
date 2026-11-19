import { createHash, randomBytes } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

const CONTRACT_ID_PATTERN = /^C[A-Z2-7]{55}$/;
const PUBLIC_HASH_PATTERN = /^[a-f0-9]{64}$/;
const PRIVATE_KEY_HEX_PATTERN = /(?<![0-9a-fA-F])(?:0x)?[0-9a-fA-F]{64}(?![0-9a-fA-F])/;

const ALLOWED_HASH_FIELDS = new Set([
  "artifactSha256",
  "interfaceSha256",
  "manifestSha256",
  "resourceHash",
  "sessionId",
  "sha256",
  "transactionHash",
  "usageHash",
  "wasmHash",
]);

const SECRET_RULES = [
  { rule: "stellar-secret-seed", pattern: /(?<![A-Z2-7])S[A-Z2-7]{55}(?![A-Z2-7])/ },
  { rule: "mnemonic-phrase", pattern: /(?<![a-z])(?:[a-z]{3,8} ){11,}[a-z]{3,8}(?![a-z])/ },
  { rule: "xdr-envelope", pattern: /[A-Za-z0-9+/]{80,}={0,2}/ },
];

const SECRET_ENV_NAME_PATTERN = /(?:SECRET|PRIVATE_KEY|SEED|MNEMONIC|PASSPHRASE_KEY|SIGNING_KEY)/i;
const WINDOWS_RETRYABLE_CODES = new Set(["EPERM", "EACCES", "EBUSY", "EEXIST"]);

export class ManifestValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ManifestValidationError";
  }
}

export class ManifestSecretError extends Error {
  constructor(message, findings = []) {
    super(message);
    this.name = "ManifestSecretError";
    this.findings = findings;
  }
}

export class ManifestConcurrencyError extends Error {
  constructor(message) {
    super(message);
    this.name = "ManifestConcurrencyError";
  }
}

export class ManifestStaleWriteError extends Error {
  constructor(message) {
    super(message);
    this.name = "ManifestStaleWriteError";
  }
}

export const defaultFsOps = Object.freeze({
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeSync,
});

export function sha256Hex(content) {
  return createHash("sha256").update(content).digest("hex");
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Validates that a local deployment manifest has a safe, parseable object structure
 * before it is written to disk.
 */
export function validateLocalManifestSchema(manifest, { supportedNetworks } = {}) {
  if (!isPlainObject(manifest)) {
    throw new ManifestValidationError("Manifest must be a JSON object");
  }

  if (manifest.network !== undefined) {
    if (typeof manifest.network !== "string" || manifest.network.length === 0) {
      throw new ManifestValidationError('Manifest "network" field must be a non-empty string');
    }
    if (supportedNetworks && !supportedNetworks.includes(manifest.network)) {
      throw new ManifestValidationError(
        `Unsupported network "${manifest.network}". Supported networks are: ${supportedNetworks.join(", ")}`,
      );
    }
  }

  if (manifest.contracts !== undefined) {
    if (!isPlainObject(manifest.contracts)) {
      throw new ManifestValidationError('Manifest "contracts" field must be an object');
    }
    for (const [name, entry] of Object.entries(manifest.contracts)) {
      if (!isPlainObject(entry)) {
        throw new ManifestValidationError(`Manifest contract entry "${name}" must be an object`);
      }
      if (entry.contractId !== undefined) {
        if (typeof entry.contractId !== "string" || !CONTRACT_ID_PATTERN.test(entry.contractId)) {
          throw new ManifestValidationError(
            `Manifest contract entry "${name}" has an invalid contractId`,
          );
        }
      }
    }
  }
}

/**
 * Scans a local manifest or journal object for accidental secret material
 * (Stellar secret seeds, mnemonics, private key hex outside hash fields,
 * signed XDR envelopes, and configured environment secret values).
 * Reports only field paths and rule names, never secret values.
 */
export function scanLocalSecrets(value, { env = process.env } = {}) {
  const findings = [];
  const envSecrets = [];
  for (const [key, val] of Object.entries(env ?? {})) {
    if (SECRET_ENV_NAME_PATTERN.test(key) && typeof val === "string" && val.length >= 8) {
      envSecrets.push(val);
    }
  }

  visit(value, "$");
  return findings;

  function visit(node, path) {
    if (Array.isArray(node)) {
      node.forEach((entry, index) => visit(entry, `${path}[${index}]`));
      return;
    }
    if (isPlainObject(node)) {
      Object.keys(node).forEach((key, index) => {
        const keyRules = scanString(key, key);
        if (keyRules.length > 0) {
          findings.push({ path: `${path}.<key #${index}>`, rule: keyRules[0] });
        }
        visit(node[key], `${path}.${keyRules.length > 0 ? "<redacted key>" : key}`);
      });
      return;
    }
    if (typeof node === "string") {
      const field = path.match(/\.([A-Za-z0-9_-]+)$/)?.[1] ?? "";
      for (const rule of scanString(node, field)) {
        findings.push({ path, rule });
      }
    }
  }

  function scanString(text, field) {
    const rules = SECRET_RULES.filter(({ pattern }) => pattern.test(text)).map(({ rule }) => rule);
    const isPublicHash = ALLOWED_HASH_FIELDS.has(field) && PUBLIC_HASH_PATTERN.test(text);
    if (!isPublicHash && PRIVATE_KEY_HEX_PATTERN.test(text)) {
      rules.push("private-key-hex");
    }
    if (envSecrets.some((secret) => text.includes(secret))) {
      rules.push("configured-env-secret");
    }
    return [...new Set(rules)];
  }
}

/**
 * Captures a content snapshot of a file for optimistic concurrency / stale-write checks.
 */
export function snapshotFile(targetPath, { fsOps = defaultFsOps } = {}) {
  const resolved = resolve(targetPath);
  if (!fsOps.existsSync(resolved)) {
    return { path: resolved, exists: false, sha256: null, size: 0 };
  }
  const stat = fsOps.statSync(resolved);
  if (stat.isDirectory()) {
    throw new ManifestValidationError(`Target manifest path is a directory: ${resolved}`);
  }
  const raw = fsOps.readFileSync(resolved, "utf8");
  return {
    path: resolved,
    exists: true,
    sha256: sha256Hex(raw),
    size: Buffer.byteLength(raw, "utf8"),
  };
}

/**
 * Replaces `targetPath` with `tempPath` atomically.
 *
 * On POSIX (Linux/macOS), `renameSync` atomically replaces an existing file on the same filesystem.
 * On Windows (`win32`), `MoveFileExW` can transiently fail with `EPERM`, `EACCES`, `EBUSY`, or
 * `EEXIST` when another handle briefly inspects the destination; we retry a bounded number of times
 * without ever unlinking the existing valid target first.
 */
export function atomicReplaceFile(
  tempPath,
  targetPath,
  { platform = process.platform, fsOps = defaultFsOps, maxRetries = 3 } = {},
) {
  const attempts = platform === "win32" ? Math.max(1, maxRetries) : 1;
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      fsOps.renameSync(tempPath, targetPath);
      return;
    } catch (err) {
      lastError = err;
      const retryable = platform === "win32" && WINDOWS_RETRYABLE_CODES.has(err?.code);
      if (!retryable || attempt === attempts) {
        throw err;
      }
    }
  }
  throw lastError;
}

/**
 * Validates, writes to a same-directory temporary file, fsyncs, re-validates the temp file,
 * and atomically replaces the exact target path while holding an exclusive lock file.
 *
 * Existing valid files are never modified or removed if validation, secret scanning,
 * concurrency checks, temp-file writing, or replacement fail.
 */
export function writeJsonAtomic(
  targetPath,
  value,
  {
    expectedSnapshot,
    expectedSha256,
    validate,
    checkSecrets = true,
    env = process.env,
    platform = process.platform,
    fsOps = defaultFsOps,
    maxRetries = 3,
  } = {},
) {
  if (typeof targetPath !== "string" || targetPath.trim().length === 0) {
    throw new ManifestValidationError("Manifest path must be a non-empty string");
  }

  const resolvedTarget = resolve(targetPath);
  if (fsOps.existsSync(resolvedTarget)) {
    const stat = fsOps.lstatSync(resolvedTarget);
    if (stat.isDirectory()) {
      throw new ManifestValidationError(`Target manifest path is a directory: ${resolvedTarget}`);
    }
  }

  if (typeof validate === "function") {
    validate(value);
  }

  if (checkSecrets) {
    const findings = scanLocalSecrets(value, { env });
    if (findings.length > 0) {
      const summary = findings.map((f) => `${f.path} (${f.rule})`).join(", ");
      throw new ManifestSecretError(
        `Refusing to write manifest containing potential secret material: ${summary}`,
        findings,
      );
    }
  }

  let serialized;
  try {
    serialized = `${JSON.stringify(value, null, 2)}\n`;
  } catch (err) {
    throw new ManifestValidationError(`Failed to serialize manifest JSON: ${err.message}`);
  }

  let reparsed;
  try {
    reparsed = JSON.parse(serialized);
  } catch (err) {
    throw new ManifestValidationError(`Serialized manifest is not valid JSON: ${err.message}`);
  }
  if (!isPlainObject(reparsed)) {
    throw new ManifestValidationError("Serialized manifest must decode to a JSON object");
  }

  const dir = dirname(resolvedTarget);
  fsOps.mkdirSync(dir, { recursive: true });

  const lockPath = `${resolvedTarget}.lock`;
  let lockAcquired = false;
  let tempPath = null;

  try {
    try {
      const lockFd = fsOps.openSync(lockPath, "wx", 0o600);
      try {
        fsOps.writeSync(lockFd, `${process.pid}\n`, 0, "utf8");
      } finally {
        fsOps.closeSync(lockFd);
      }
      lockAcquired = true;
    } catch (err) {
      if (err?.code === "EEXIST") {
        throw new ManifestConcurrencyError(
          `Concurrent manifest write detected for ${resolvedTarget}: lock file ${lockPath} already exists`,
        );
      }
      throw err;
    }

    verifyExpectedState(resolvedTarget, { expectedSnapshot, expectedSha256, fsOps });

    const expectedContentHash = sha256Hex(serialized);
    const uniqueSuffix = `${process.pid}.${randomBytes(8).toString("hex")}`;
    tempPath = join(dir, `.${basename(resolvedTarget)}.${uniqueSuffix}.tmp`);

    const tempFd = fsOps.openSync(tempPath, "wx", 0o600);
    try {
      const buffer = Buffer.from(serialized, "utf8");
      let offset = 0;
      while (offset < buffer.length) {
        const written = fsOps.writeSync(tempFd, buffer, offset, buffer.length - offset);
        if (written <= 0) {
          throw new Error("Short write while writing temporary manifest file");
        }
        offset += written;
      }
      fsOps.fsyncSync(tempFd);
    } finally {
      fsOps.closeSync(tempFd);
    }

    // Re-read and validate the temporary file before replacing the live manifest.
    const stagedRaw = fsOps.readFileSync(tempPath, "utf8");
    if (sha256Hex(stagedRaw) !== expectedContentHash) {
      throw new ManifestValidationError("Temporary manifest verification failed: checksum mismatch");
    }
    const stagedParsed = JSON.parse(stagedRaw);
    if (!isPlainObject(stagedParsed)) {
      throw new ManifestValidationError("Temporary manifest verification failed: not a JSON object");
    }

    atomicReplaceFile(tempPath, resolvedTarget, { platform, fsOps, maxRetries });
    tempPath = null;

    return {
      path: resolvedTarget,
      sha256: expectedContentHash,
      size: Buffer.byteLength(serialized, "utf8"),
    };
  } finally {
    if (tempPath && fsOps.existsSync(tempPath)) {
      try {
        fsOps.rmSync(tempPath, { force: true });
      } catch {
        // Best-effort cleanup of temp file.
      }
    }
    if (lockAcquired && fsOps.existsSync(lockPath)) {
      try {
        fsOps.rmSync(lockPath, { force: true });
      } catch {
        // Best-effort cleanup of lock file.
      }
    }
  }
}

function verifyExpectedState(resolvedTarget, { expectedSnapshot, expectedSha256, fsOps }) {
  if (expectedSnapshot !== undefined) {
    const current = snapshotFile(resolvedTarget, { fsOps });
    if (expectedSnapshot.exists !== current.exists) {
      throw new ManifestStaleWriteError(
        `Stale manifest write detected for ${resolvedTarget}: file existence changed since read`,
      );
    }
    if (expectedSnapshot.exists && expectedSnapshot.sha256 !== current.sha256) {
      throw new ManifestStaleWriteError(
        `Stale manifest write detected for ${resolvedTarget}: content changed since read`,
      );
    }
  } else if (expectedSha256 !== undefined) {
    const current = snapshotFile(resolvedTarget, { fsOps });
    if (expectedSha256 === null) {
      if (current.exists) {
        throw new ManifestStaleWriteError(
          `Stale manifest write detected for ${resolvedTarget}: file was created concurrently`,
        );
      }
    } else if (!current.exists || current.sha256 !== expectedSha256) {
      throw new ManifestStaleWriteError(
        `Stale manifest write detected for ${resolvedTarget}: content hash does not match expected state`,
      );
    }
  }
}
