import { createHash } from "node:crypto";

export const WASM_ALLOWLIST_SCHEMA_VERSION = 1;
const VALID_CLASSIFICATIONS = new Set(["production", "utility-only", "example-only"]);
const VALID_KINDS = new Set(["function", "memory", "table", "global", "tag"]);

export function inspectWasmBytes(bytes) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const module = new WebAssembly.Module(buffer);
  const imports = WebAssembly.Module.imports(module)
    .map((entry) => ({
      module: entry.module,
      name: entry.name,
      kind: entry.kind,
    }))
    .sort(compareImport);
  const exports = WebAssembly.Module.exports(module)
    .map((entry) => ({
      name: entry.name,
      kind: entry.kind,
    }))
    .sort(compareExport);

  return {
    sha256: createHash("sha256").update(buffer).digest("hex"),
    sizeBytes: buffer.length,
    imports,
    exports,
  };
}

export function validateWasmAllowlist(allowlist) {
  if (!allowlist || typeof allowlist !== "object" || allowlist.schemaVersion !== WASM_ALLOWLIST_SCHEMA_VERSION) {
    throw new Error(`WASM allowlist must use schemaVersion ${WASM_ALLOWLIST_SCHEMA_VERSION}.`);
  }
  if (typeof allowlist.contract !== "string" || allowlist.contract.trim() === "") {
    throw new Error("WASM allowlist must specify a contract name.");
  }
  if (!VALID_CLASSIFICATIONS.has(allowlist.classification)) {
    throw new Error(
      `WASM allowlist for ${allowlist.contract} has invalid classification "${allowlist.classification}".`,
    );
  }
  if (typeof allowlist.artifact !== "string" || allowlist.artifact.trim() === "") {
    throw new Error(`WASM allowlist for ${allowlist.contract} must specify an artifact path.`);
  }
  if (!Array.isArray(allowlist.imports) || !Array.isArray(allowlist.exports)) {
    throw new Error(`WASM allowlist for ${allowlist.contract} must define imports and exports arrays.`);
  }

  const seenImports = new Set();
  for (const entry of allowlist.imports) {
    if (
      typeof entry?.module !== "string" ||
      entry.module.trim() === "" ||
      typeof entry?.name !== "string" ||
      entry.name.trim() === "" ||
      !VALID_KINDS.has(entry?.kind)
    ) {
      throw new Error(`Invalid WASM import entry in ${allowlist.contract}: ${JSON.stringify(entry)}`);
    }
    const key = importKey(entry);
    if (seenImports.has(key)) {
      throw new Error(`Duplicate WASM import allowlist entry in ${allowlist.contract}: ${key}`);
    }
    seenImports.add(key);
  }

  const seenExports = new Set();
  for (const entry of allowlist.exports) {
    if (
      typeof entry?.name !== "string" ||
      entry.name.trim() === "" ||
      !VALID_KINDS.has(entry?.kind)
    ) {
      throw new Error(`Invalid WASM export entry in ${allowlist.contract}: ${JSON.stringify(entry)}`);
    }
    const key = exportKey(entry);
    if (seenExports.has(key)) {
      throw new Error(`Duplicate WASM export allowlist entry in ${allowlist.contract}: ${key}`);
    }
    seenExports.add(key);
  }
}

export function compareWasmSurface(observed, allowlist) {
  validateWasmAllowlist(allowlist);

  const allowedImports = new Map(allowlist.imports.map((entry) => [importKey(entry), entry]));
  const observedImports = new Map(observed.imports.map((entry) => [importKey(entry), entry]));
  const allowedExports = new Map(allowlist.exports.map((entry) => [exportKey(entry), entry]));
  const observedExports = new Map(observed.exports.map((entry) => [exportKey(entry), entry]));

  const unexpectedImports = [...observedImports.entries()]
    .filter(([key]) => !allowedImports.has(key))
    .map(([, entry]) => entry)
    .sort(compareImport);

  const missingImports = [...allowedImports.entries()]
    .filter(([key]) => !observedImports.has(key))
    .map(([, entry]) => entry)
    .sort(compareImport);

  const unexpectedExports = [...observedExports.entries()]
    .filter(([key]) => !allowedExports.has(key))
    .map(([, entry]) => entry)
    .sort(compareExport);

  const missingExports = [...allowedExports.entries()]
    .filter(([key]) => !observedExports.has(key))
    .map(([, entry]) => entry)
    .sort(compareExport);

  const diffLines = [];
  for (const entry of unexpectedImports) {
    diffLines.push(`+ import ${entry.module}.${entry.name} (${entry.kind})`);
  }
  for (const entry of missingImports) {
    diffLines.push(`- import ${entry.module}.${entry.name} (${entry.kind})`);
  }
  for (const entry of unexpectedExports) {
    diffLines.push(`+ export ${entry.name} (${entry.kind})`);
  }
  for (const entry of missingExports) {
    diffLines.push(`- export ${entry.name} (${entry.kind})`);
  }

  return {
    contract: allowlist.contract,
    classification: allowlist.classification,
    artifact: allowlist.artifact,
    sha256: observed.sha256,
    sizeBytes: observed.sizeBytes,
    importCount: observed.imports.length,
    exportCount: observed.exports.length,
    unexpectedImports,
    missingImports,
    unexpectedExports,
    missingExports,
    diffLines,
    passed:
      unexpectedImports.length === 0 &&
      unexpectedExports.length === 0 &&
      missingExports.length === 0,
  };
}

export function formatWasmDiff(comparison) {
  if (comparison.diffLines.length === 0) {
    return `${comparison.contract}: no import/export differences.`;
  }
  return [
    `${comparison.contract} (${comparison.classification}, ${comparison.artifact}):`,
    ...comparison.diffLines.map((line) => `  ${line}`),
  ].join("\n");
}

function importKey(entry) {
  return `${entry.module}\0${entry.name}\0${entry.kind}`;
}

function exportKey(entry) {
  return `${entry.name}\0${entry.kind}`;
}

function compareImport(left, right) {
  return (
    left.module.localeCompare(right.module) ||
    left.name.localeCompare(right.name) ||
    left.kind.localeCompare(right.kind)
  );
}

function compareExport(left, right) {
  return left.name.localeCompare(right.name) || left.kind.localeCompare(right.kind);
}
