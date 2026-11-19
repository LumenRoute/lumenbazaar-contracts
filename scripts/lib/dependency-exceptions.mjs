export const ADVISORY_REQUIRED_FIELDS = [
  "advisory",
  "package",
  "classification",
  "owner",
  "expiresOn",
  "dependencyPath",
  "resolution",
  "risk",
];

export const DENY_REQUIRED_FIELDS = [
  "crate",
  "category",
  "owner",
  "expiresOn",
  "dependencyPath",
  "justification",
  "resolution",
];

export const ALLOWED_DENY_CATEGORIES = new Set(["duplicate-version", "license-exception"]);

export function validateAdvisoryExceptions(manifest, today = utcToday()) {
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.exceptions)) {
    throw new Error(
      "Dependency exception manifest must use schemaVersion 1 and contain an exceptions array.",
    );
  }

  const advisories = new Set();
  for (const exception of manifest.exceptions) {
    for (const field of ADVISORY_REQUIRED_FIELDS) {
      if (typeof exception[field] !== "string" || exception[field].trim() === "") {
        throw new Error(`Dependency exception is missing ${field}.`);
      }
    }
    if (advisories.has(exception.advisory)) {
      throw new Error(`Duplicate dependency exception: ${exception.advisory}`);
    }
    advisories.add(exception.advisory);
    assertFutureDate(exception.expiresOn, exception.advisory, today);
  }

  return advisories;
}

export function validateCargoDenyExceptions(manifest, today = utcToday()) {
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.exceptions)) {
    throw new Error(
      "cargo-deny exception manifest must use schemaVersion 1 and contain an exceptions array.",
    );
  }

  const crates = new Set();
  for (const exception of manifest.exceptions) {
    for (const field of DENY_REQUIRED_FIELDS) {
      if (typeof exception[field] !== "string" || exception[field].trim() === "") {
        throw new Error(`cargo-deny exception is missing ${field}.`);
      }
    }
    if (!ALLOWED_DENY_CATEGORIES.has(exception.category)) {
      throw new Error(
        `Invalid cargo-deny exception category for ${exception.crate}: ${exception.category}`,
      );
    }
    if (!/^[A-Za-z0-9_-]+@\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(exception.crate)) {
      throw new Error(
        `cargo-deny exception crate must be pinned to an exact name@version: ${exception.crate}`,
      );
    }
    if (crates.has(exception.crate)) {
      throw new Error(`Duplicate cargo-deny exception: ${exception.crate}`);
    }
    crates.add(exception.crate);
    assertFutureDate(exception.expiresOn, exception.crate, today);
  }

  return crates;
}

export function parseDenyTomlPolicy(denyTomlText) {
  const advisoryIgnores = new Set();
  const skipCrates = new Set();

  for (const match of denyTomlText.matchAll(/\{\s*id\s*=\s*"([^"]+)"/g)) {
    advisoryIgnores.add(match[1]);
  }
  for (const match of denyTomlText.matchAll(/\{\s*crate\s*=\s*"([^"]+)"/g)) {
    skipCrates.add(match[1]);
  }

  const unknownRegistryDenied = /unknown-registry\s*=\s*"deny"/.test(denyTomlText);
  const unknownGitDenied = /unknown-git\s*=\s*"deny"/.test(denyTomlText);
  const unusedLicenseDenied = /unused-allowed-license\s*=\s*"deny"/.test(denyTomlText);
  const multipleVersionsDenied = /multiple-versions\s*=\s*"deny"/.test(denyTomlText);
  const wildcardsDenied = /wildcards\s*=\s*"deny"/.test(denyTomlText);

  return {
    advisoryIgnores,
    skipCrates,
    unknownRegistryDenied,
    unknownGitDenied,
    unusedLicenseDenied,
    multipleVersionsDenied,
    wildcardsDenied,
  };
}

export function validateDenyTomlAlignment(denyTomlText, advisoryIds, denyCrateIds) {
  const policy = parseDenyTomlPolicy(denyTomlText);

  if (!policy.unknownRegistryDenied || !policy.unknownGitDenied) {
    throw new Error("deny.toml must set unknown-registry = \"deny\" and unknown-git = \"deny\".");
  }
  if (!policy.unusedLicenseDenied) {
    throw new Error("deny.toml must set unused-allowed-license = \"deny\".");
  }
  if (!policy.multipleVersionsDenied || !policy.wildcardsDenied) {
    throw new Error("deny.toml must set multiple-versions = \"deny\" and wildcards = \"deny\".");
  }

  for (const id of policy.advisoryIgnores) {
    if (!advisoryIds.has(id)) {
      throw new Error(
        `deny.toml ignores advisory ${id} without a matching record in audits/dependency-exceptions.json.`,
      );
    }
  }
  for (const crate of policy.skipCrates) {
    if (!denyCrateIds.has(crate)) {
      throw new Error(
        `deny.toml skips crate ${crate} without a matching record in audits/cargo-deny-exceptions.json.`,
      );
    }
  }
  for (const crate of denyCrateIds) {
    if (!policy.skipCrates.has(crate)) {
      throw new Error(
        `audits/cargo-deny-exceptions.json contains stale record ${crate} not present in deny.toml.`,
      );
    }
  }
}

function assertFutureDate(expiresOn, label, today) {
  const expiry = new Date(`${expiresOn}T00:00:00Z`);
  if (Number.isNaN(expiry.getTime())) {
    throw new Error(`Invalid expiry for ${label}: ${expiresOn}`);
  }
  if (expiry < today) {
    throw new Error(`Dependency exception ${label} expired on ${expiresOn}.`);
  }
}

function utcToday() {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  return today;
}
