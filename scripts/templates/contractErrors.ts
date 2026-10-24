// Typed decoding of upto-session contract failures.
//
// Maintained as a template and copied into the generated binding by
// scripts/generate-bindings.mjs, which fails if CONTRACT_ERROR_CODES drifts
// from the frozen interface fixture (artifacts/interface/upto-session-v3.json).

/** Every stable ContractError code, by name. */
export const CONTRACT_ERROR_CODES = {
  AlreadyInitialized: 1,
  Unauthorized: 2,
  InvalidAmount: 3,
  ExpiredSession: 4,
  SessionNotFound: 5,
  SessionAlreadySettled: 6,
  SessionCancelled: 7,
  AmountExceedsCap: 8,
  InvalidAsset: 9,
  InvalidSeller: 10,
  TtlExtensionFailed: 11,
  InvalidResourceHash: 12,
  InvalidUsageHash: 13,
  UnsupportedAsset: 14,
  InvalidSupportedAssets: 15,
  SessionDurationTooLong: 16,
  LiabilityOverflow: 17,
  LiabilityUnderflow: 18,
  EscrowUnderfunded: 19,
  NotInitialized: 20,
  SessionExpired: 21,
  SessionNotExpired: 22,
  InvalidAssetCap: 23,
  AssetCapNotConfigured: 24,
  InvalidAdmin: 25,
  InvalidAdminRotationExpiry: 26,
  AdminRotationPending: 27,
  AdminRotationNotFound: 28,
  AdminRotationExpired: 29,
  TokenInvariantViolation: 30,
  InvalidBatchSize: 31,
  InvalidAssetInterface: 32,
  AssetNotActive: 33,
  AssetNotDeprecated: 34,
  AssetLiabilityOutstanding: 35,
  AssetAlreadyActive: 36,
  AssetDeprecated: 37,
  AssetLimitReached: 38,
} as const;

export type ContractErrorName = keyof typeof CONTRACT_ERROR_CODES;
export type ContractErrorCode = (typeof CONTRACT_ERROR_CODES)[ContractErrorName];

/** Reverse lookup: stable code to name. */
export const CONTRACT_ERROR_NAMES: Readonly<Record<number, ContractErrorName>> = Object.freeze(
  Object.fromEntries(
    Object.entries(CONTRACT_ERROR_CODES).map(([name, code]) => [code, name as ContractErrorName]),
  ),
);

/**
 * Result of `decodeContractError`. Only `contract` carries a typed name; every
 * other kind keeps the original value in `cause` so callers can still log or
 * rethrow it.
 *
 * - `contract`: a known upto-session error code.
 * - `unknown_contract`: a well-formed contract error code this binding does not
 *   know (for example a newer contract version).
 * - `malformed_contract`: text that looks like a contract error but whose code
 *   cannot be parsed as a u32.
 * - `host`: a host failure that is not a contract error, such as
 *   `Error(Auth, InvalidAction)` or `Error(Budget, ExceededLimit)`.
 * - `other`: anything else, including transport, RPC and timeout failures.
 */
export type DecodedContractError =
  | { kind: "contract"; code: ContractErrorCode; name: ContractErrorName; cause: unknown }
  | { kind: "unknown_contract"; code: number; cause: unknown }
  | { kind: "malformed_contract"; raw: string; cause: unknown }
  | { kind: "host"; type: string; detail: string; cause: unknown }
  | { kind: "other"; cause: unknown };

const MAX_U32 = 4294967295;
const MAX_DEPTH = 5;
// "Error(Contract, #5)" as printed by the host in simulation and transaction
// diagnostics. The code group is deliberately permissive so malformed codes
// are reported rather than ignored.
const CONTRACT_ERROR_PATTERN = /Error\(\s*Contract\s*,\s*#([^)\s]*)\s*\)/;
const HOST_ERROR_PATTERN = /Error\(\s*([A-Za-z]+)\s*,\s*([^)]*?)\s*\)/;

/**
 * Extracts a typed upto-session error from a thrown value, a simulation
 * response, a JSON-RPC error, or a binding `Result` error, without
 * flattening unrelated failures into contract errors.
 */
export function decodeContractError(error: unknown): DecodedContractError {
  return decodeFrom(error, error, 0) ?? { kind: "other", cause: error };
}

/** True when `error` decodes to the given known contract error. */
export function isContractError(error: unknown, name: ContractErrorName): boolean {
  const decoded = decodeContractError(error);
  return decoded.kind === "contract" && decoded.name === name;
}

function decodeFrom(value: unknown, cause: unknown, depth: number): DecodedContractError | null {
  if (value === null || value === undefined || depth > MAX_DEPTH) {
    return null;
  }
  if (typeof value === "string") {
    return decodeText(value, cause);
  }
  if (typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;

  // Binding Result errors: the generated ContractError map yields a plain
  // `{ message: "SessionNotFound" }`, wrapped by the SDK's `Err` as `.error`.
  // Only that exact shape is matched by name, so an HTTP error whose message
  // happens to be "Unauthorized" is not mistaken for contract error 2.
  if (isBindingErrorEntry(value)) {
    const byName = decodeName(record.message, cause);
    if (byName) {
      return byName;
    }
  }

  // Thrown errors and simulation/RPC payloads, most specific first.
  for (const key of ["message", "error", "data", "cause"]) {
    const nested = record[key];
    if (nested === undefined || nested === value) {
      continue;
    }
    const decoded = decodeFrom(nested, cause, depth + 1);
    if (decoded) {
      return decoded;
    }
  }
  return null;
}

function isBindingErrorEntry(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  const keys = Object.keys(value);
  return (prototype === Object.prototype || prototype === null) && keys.length === 1 && keys[0] === "message";
}

function decodeName(message: unknown, cause: unknown): DecodedContractError | null {
  if (typeof message !== "string" || !Object.prototype.hasOwnProperty.call(CONTRACT_ERROR_CODES, message)) {
    return null;
  }
  const name = message as ContractErrorName;
  return { kind: "contract", code: CONTRACT_ERROR_CODES[name], name, cause };
}

function decodeText(text: string, cause: unknown): DecodedContractError | null {
  const contract = CONTRACT_ERROR_PATTERN.exec(text);
  if (contract) {
    const raw = contract[1];
    if (!/^\d{1,10}$/.test(raw) || Number(raw) > MAX_U32) {
      return { kind: "malformed_contract", raw, cause };
    }
    const code = Number(raw);
    const name = CONTRACT_ERROR_NAMES[code];
    return name
      ? { kind: "contract", code: code as ContractErrorCode, name, cause }
      : { kind: "unknown_contract", code, cause };
  }
  const host = HOST_ERROR_PATTERN.exec(text);
  if (host) {
    return { kind: "host", type: host[1], detail: host[2], cause };
  }
  return null;
}
