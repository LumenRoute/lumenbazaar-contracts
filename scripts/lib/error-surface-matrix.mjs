import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const VALID_CATEGORIES = new Set(["validation", "authorization", "token", "state"]);

export const ERROR_CATEGORIES = {
  AlreadyInitialized: "state",
  Unauthorized: "authorization",
  InvalidAmount: "validation",
  ExpiredSession: "state",
  SessionNotFound: "state",
  SessionAlreadySettled: "state",
  SessionCancelled: "state",
  AmountExceedsCap: "validation",
  InvalidAsset: "validation",
  InvalidSeller: "validation",
  TtlExtensionFailed: "state",
  InvalidResourceHash: "validation",
  InvalidUsageHash: "validation",
  UnsupportedAsset: "state",
  InvalidSupportedAssets: "validation",
  SessionDurationTooLong: "validation",
  LiabilityOverflow: "state",
  LiabilityUnderflow: "state",
  EscrowUnderfunded: "token",
  NotInitialized: "state",
  SessionExpired: "state",
  SessionNotExpired: "state",
  InvalidAssetCap: "validation",
  AssetCapNotConfigured: "state",
  InvalidAdmin: "validation",
  InvalidAdminRotationExpiry: "validation",
  AdminRotationPending: "state",
  AdminRotationNotFound: "state",
  AdminRotationExpired: "state",
  TokenInvariantViolation: "token",
  InvalidBatchSize: "validation",
  InvalidAssetInterface: "token",
  AssetNotActive: "state",
  AssetNotDeprecated: "state",
  AssetLiabilityOutstanding: "state",
  CreationPaused: "state",
  OperationalStateUnchanged: "state",
  CapIncreasePending: "state",
  CapIncreaseNotReady: "state",
  CapIncreaseNotFound: "state",
  CapIncreaseExpired: "state",
  InvalidCapIncreaseDelay: "validation",
  UnsupportedCommitmentScheme: "validation",
  SellerExposureCeilingExceeded: "state",
  SellerExposureCeilingNotConfigured: "state",
  BuyerOpenSessionsExceeded: "state",
  InvalidSessionCountLimit: "validation",
  SellerOpenSessionsExceeded: "state",
  InvalidCapReduction: "validation",
  SessionRejected: "state",
  AssetAlreadyActive: "state",
  AssetDeprecated: "state",
  AssetLimitReached: "state",
  AssetExposureCeilingExceeded: "state",
  InvalidExposureCeiling: "validation",
  ExposureCeilingNotConfigured: "state",
  BuyerExposureCeilingExceeded: "state",
  BuyerExposureUnderflow: "state",
  SequenceExhausted: "state",
  IdempotencyConflict: "state",
};

/**
 * Focused test evidence for errors whose tests assert host-level auth traps or
 * token-transfer rollbacks rather than matching `ContractError::Variant` literally.
 */
export const SUPPLEMENTAL_ERROR_TESTS = {
  Unauthorized: [
    "create_session_requires_buyer_auth",
    "settle_requires_seller_auth",
    "cancel_requires_buyer_auth",
    "asset_deprecation_requires_admin_and_blocks_new_sessions",
  ],
  TokenInvariantViolation: [
    "adversarial_create_failures_roll_back_funds_liability_and_sequence",
    "adversarial_terminal_failures_leave_the_session_open_and_funded",
  ],
};

export function parseStableErrors(errorsSource) {
  const errors = [];
  for (const match of errorsSource.matchAll(/^\s+([A-Za-z0-9_]+)\s*=\s*(\d+),/gm)) {
    errors.push({ name: match[1], code: Number(match[2]) });
  }
  errors.sort((a, b) => a.code - b.code);
  return errors;
}

export function extractFunctions(source) {
  const fns = {};
  const lines = source.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^\s*(?:pub\s+)?fn\s+([a-zA-Z0-9_]+)\s*\(/);
    if (!match) continue;
    const name = match[1];
    let depth = 0;
    let started = false;
    const body = [];
    for (let j = i; j < lines.length; j++) {
      const line = lines[j];
      body.push(line);
      for (const ch of line) {
        if (ch === "{") {
          depth += 1;
          started = true;
        } else if (ch === "}") {
          depth -= 1;
        }
      }
      if (started && depth === 0) break;
    }
    fns[name] = body.join("\n");
  }
  return fns;
}

function extractCaughtErrors(body) {
  const caught = new Set();
  // Match `Err(ContractError::A | ContractError::B) => <expr>` arms that do NOT `return Err`.
  const armPattern = /Err\(([^)]*ContractError::[^)]*)\)\s*=>\s*([^,}]+)/gs;
  for (const match of body.matchAll(armPattern)) {
    const rhs = match[2];
    if (/\breturn\s+Err\b/.test(rhs)) continue;
    for (const errMatch of match[1].matchAll(/ContractError::([A-Za-z0-9_]+)/g)) {
      caught.add(errMatch[1]);
    }
  }
  return caught;
}

function extractDirectErrors(body) {
  const errors = new Set();
  const caught = extractCaughtErrors(body);
  for (const match of body.matchAll(/ContractError::([A-Za-z0-9_]+)/g)) {
    if (!caught.has(match[1])) {
      errors.add(match[1]);
    }
  }
  return errors;
}

export function analyzeContractSource({ libSource, validationSource, storageSource, errorsSource }) {
  const stableErrors = parseStableErrors(errorsSource);
  const valFns = extractFunctions(validationSource);
  const stoFns = extractFunctions(storageSource);

  const implStart = libSource.indexOf("impl UptoSessionContract {");
  if (implStart === -1) {
    throw new Error("Could not find `impl UptoSessionContract {` in lib.rs");
  }
  const helperStart = libSource.indexOf("\nfn ", implStart);
  const implSection = helperStart === -1 ? libSource.slice(implStart) : libSource.slice(implStart, helperStart);
  const helperSection = helperStart === -1 ? "" : libSource.slice(helperStart);

  const pubFns = extractFunctions(implSection);
  const libHelpers = extractFunctions(helperSection);

  function trace(body, visited = new Set()) {
    const caught = extractCaughtErrors(body);
    const errors = extractDirectErrors(body);
    let authEnforced = /\.require_auth\s*\(/.test(body);

    for (const match of body.matchAll(/validation::([a-z0-9_]+)\s*\(/g)) {
      const key = `val:${match[1]}`;
      if (!visited.has(key) && valFns[match[1]]) {
        visited.add(key);
        const sub = trace(valFns[match[1]], visited);
        for (const e of sub.errors) if (!caught.has(e)) errors.add(e);
        authEnforced = authEnforced || sub.authEnforced;
      }
    }
    for (const match of body.matchAll(/storage::([a-z0-9_]+)\s*\(/g)) {
      const key = `sto:${match[1]}`;
      if (!visited.has(key) && stoFns[match[1]]) {
        visited.add(key);
        const sub = trace(stoFns[match[1]], visited);
        for (const e of sub.errors) if (!caught.has(e)) errors.add(e);
        authEnforced = authEnforced || sub.authEnforced;
      }
    }
    for (const [helperName, helperBody] of Object.entries(libHelpers)) {
      const callRe = new RegExp(`\\b${helperName}\\s*\\(`);
      const key = `lib:${helperName}`;
      if (!visited.has(key) && callRe.test(body)) {
        visited.add(key);
        const sub = trace(helperBody, visited);
        for (const e of sub.errors) if (!caught.has(e)) errors.add(e);
        authEnforced = authEnforced || sub.authEnforced;
      }
    }
    return { errors, authEnforced };
  }

  const methods = {};
  for (const name of Object.keys(pubFns).sort()) {
    const { errors, authEnforced } = trace(pubFns[name]);
    if (authEnforced) {
      errors.add("Unauthorized");
    }
    methods[name] = {
      authorizationEnforced: authEnforced,
      errors: [...errors].sort(),
    };
  }

  return { stableErrors, methods };
}

export function collectRustTests(srcDir) {
  const allTests = new Set();
  const testsByError = new Map();

  for (const file of readdirSync(srcDir).filter((f) => f.endsWith(".rs"))) {
    if (file === "errors.rs") continue;
    const lines = readFileSync(join(srcDir, file), "utf8").split(/\r?\n/);
    let currentTest = null;
    for (let i = 0; i < lines.length; i++) {
      if (/^\s*#\[test\]/.test(lines[i])) {
        for (let k = i + 1; k < Math.min(i + 6, lines.length); k++) {
          const match = lines[k].match(/^\s*fn\s+([a-zA-Z0-9_]+)\s*\(/);
          if (match) {
            currentTest = match[1];
            allTests.add(currentTest);
            break;
          }
        }
      }
      if (currentTest) {
        for (const match of lines[i].matchAll(/ContractError::([A-Za-z0-9_]+)/g)) {
          const errName = match[1];
          if (!testsByError.has(errName)) testsByError.set(errName, new Set());
          testsByError.get(errName).add(currentTest);
        }
      }
    }
  }

  return { allTests, testsByError };
}

export function parseHandoffDescriptions(handoffMarkdown) {
  const descriptions = {};
  for (const match of handoffMarkdown.matchAll(/^\|\s*(\d+)\s*\|\s*`([A-Za-z0-9_]+)`\s*\|\s*(?:`(validation|authorization|token|state)`\s*\|\s*)?([^|]+)\|/gm)) {
    const name = match[2];
    const desc = match[4].trim();
    if (desc) {
      descriptions[name] = desc;
    }
  }
  return descriptions;
}

export function buildErrorSurfaceMatrix({
  libSource,
  validationSource,
  storageSource,
  errorsSource,
  allTests,
  testsByError,
  handoffDescriptions,
}) {
  const { stableErrors, methods } = analyzeContractSource({
    libSource,
    validationSource,
    storageSource,
    errorsSource,
  });

  const errorCodeByName = new Map(stableErrors.map((e) => [e.name, e.code]));
  const methodsByError = new Map(stableErrors.map((e) => [e.name, []]));

  const methodEntries = [];
  for (const [methodName, info] of Object.entries(methods).sort(([a], [b]) => a.localeCompare(b))) {
    const edges = [];
    for (const errName of info.errors) {
      const code = errorCodeByName.get(errName);
      if (code === undefined) {
        throw new Error(`Method ${methodName} references unknown ContractError::${errName}`);
      }
      const category = ERROR_CATEGORIES[errName];
      if (!VALID_CATEGORIES.has(category)) {
        throw new Error(`Missing or invalid category for ContractError::${errName}`);
      }
      const directTests = [...(testsByError.get(errName) ?? [])].sort();
      const supplemental = SUPPLEMENTAL_ERROR_TESTS[errName] ?? [];
      const tests = [...new Set([...directTests, ...supplemental])].filter((t) => allTests.has(t)).sort();
      const handoff = handoffDescriptions[errName] ?? "";

      methodsByError.get(errName).push(methodName);
      edges.push({
        error: errName,
        code,
        category,
        hostEnforced: errName === "Unauthorized",
        tests: tests.slice(0, 5),
        handoff,
      });
    }
    edges.sort((a, b) => a.code - b.code);
    methodEntries.push({
      method: methodName,
      authorizationEnforced: info.authorizationEnforced,
      errors: edges,
    });
  }

  const errorEntries = stableErrors.map(({ name, code }) => {
    const directTests = [...(testsByError.get(name) ?? [])].sort();
    const supplemental = SUPPLEMENTAL_ERROR_TESTS[name] ?? [];
    const tests = [...new Set([...directTests, ...supplemental])].filter((t) => allTests.has(t)).sort();
    return {
      error: name,
      code,
      category: ERROR_CATEGORIES[name],
      methods: (methodsByError.get(name) ?? []).sort(),
      tests: tests.slice(0, 5),
      handoff: handoffDescriptions[name] ?? "",
    };
  });

  return {
    schemaVersion: 1,
    contract: "upto-session",
    interfaceVersion: 3,
    categories: ["validation", "authorization", "token", "state"],
    errorCount: errorEntries.length,
    methodCount: methodEntries.length,
    errors: errorEntries,
    methods: methodEntries,
  };
}

export function validateErrorSurfaceMatrix(matrix, expected, allTests) {
  const issues = [];

  if (matrix.schemaVersion !== 1) {
    issues.push(`Unsupported schemaVersion: ${matrix.schemaVersion}`);
  }

  // 1. Every stable error must map to >= 1 method, >= 1 existing test, valid category, and handoff description.
  for (const entry of matrix.errors ?? []) {
    if (!VALID_CATEGORIES.has(entry.category)) {
      issues.push(`Error ${entry.error} has invalid category: ${entry.category}`);
    }
    if (!Array.isArray(entry.methods) || entry.methods.length === 0) {
      issues.push(`Stable error ${entry.error} (${entry.code}) maps to zero public methods.`);
    }
    if (!Array.isArray(entry.tests) || entry.tests.length === 0) {
      issues.push(`Stable error ${entry.error} (${entry.code}) has no focused test coverage.`);
    } else {
      for (const t of entry.tests) {
        if (!allTests.has(t)) {
          issues.push(`Stable error ${entry.error} references missing Rust test: ${t}`);
        }
      }
    }
    if (typeof entry.handoff !== "string" || entry.handoff.trim() === "") {
      issues.push(`Stable error ${entry.error} (${entry.code}) is missing a backend handoff description.`);
    }
  }

  // 2. Compare committed method->error edges against source-derived expected edges.
  const actualEdges = new Set();
  for (const m of matrix.methods ?? []) {
    for (const e of m.errors ?? []) {
      actualEdges.add(`${m.method}::${e.error}`);
      if (!VALID_CATEGORIES.has(e.category)) {
        issues.push(`Edge ${m.method}::${e.error} has invalid category: ${e.category}`);
      }
      if (!Array.isArray(e.tests) || e.tests.length === 0) {
        issues.push(`Edge ${m.method}::${e.error} has no focused test.`);
      }
      if (typeof e.handoff !== "string" || e.handoff.trim() === "") {
        issues.push(`Edge ${m.method}::${e.error} is missing handoff description.`);
      }
    }
  }

  const expectedEdges = new Set();
  for (const m of expected.methods ?? []) {
    for (const e of m.errors ?? []) {
      expectedEdges.add(`${m.method}::${e.error}`);
    }
  }

  for (const edge of expectedEdges) {
    if (!actualEdges.has(edge)) {
      issues.push(`Undocumented source error edge: ${edge}`);
    }
  }
  for (const edge of actualEdges) {
    if (!expectedEdges.has(edge)) {
      issues.push(`Unreachable or stale error edge in matrix: ${edge}`);
    }
  }

  return issues;
}
