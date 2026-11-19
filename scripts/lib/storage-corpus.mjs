import { createHash } from "node:crypto";
import { scanLocalSecrets } from "./atomic-manifest.mjs";

export const STORAGE_CORPUS_LOCK_FILE = "storage-corpus.lock.json";
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const HEX_EVEN_PATTERN = /^(?:[a-f0-9]{2})+$/;

export function corpusFileName(layoutVersion) {
  return `storage-corpus-v${layoutVersion}.json`;
}

export function sha256Buffer(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function verifyStorageCorpusDocument(corpus, expectedVersion) {
  const errors = [];
  if (!corpus || typeof corpus !== "object" || Array.isArray(corpus)) {
    return ["corpus must be a JSON object"];
  }
  if (corpus.schema !== "lumenbazaar/storage-serialization-corpus") {
    errors.push(`unexpected schema ${JSON.stringify(corpus.schema)}`);
  }
  if (corpus.storageLayoutVersion !== expectedVersion) {
    errors.push(
      `storageLayoutVersion is ${JSON.stringify(corpus.storageLayoutVersion)}, expected ${expectedVersion}`,
    );
  }
  if (!Array.isArray(corpus.vectors) || corpus.vectors.length === 0) {
    errors.push("vectors must be a non-empty array");
    return errors;
  }

  const secretFindings = scanLocalSecrets(corpus).filter((finding) => {
    const isXdrVectorField = /^\$\.vectors\[\d+\]\.(?:keyXdrHex|valueXdrHex)$/.test(finding.path);
    const isExpectedHexRule =
      finding.rule === "xdr-envelope" || finding.rule === "private-key-hex";
    return !(isXdrVectorField && isExpectedHexRule);
  });
  for (const finding of secretFindings) {
    errors.push(`secret pattern matched at ${finding.path} (${finding.rule})`);
  }

  const tiers = new Set();
  const seenNames = new Set();
  let previousName = null;

  for (const [index, vector] of corpus.vectors.entries()) {
    const label = `vectors[${index}]`;
    if (!vector || typeof vector !== "object" || Array.isArray(vector)) {
      errors.push(`${label} must be an object`);
      continue;
    }
    if (typeof vector.name !== "string" || vector.name.length === 0) {
      errors.push(`${label}.name must be a non-empty string`);
    } else {
      if (seenNames.has(vector.name)) {
        errors.push(`duplicate vector name ${JSON.stringify(vector.name)}`);
      }
      seenNames.add(vector.name);
      if (previousName !== null && vector.name < previousName) {
        errors.push(`vectors are not sorted deterministically at ${JSON.stringify(vector.name)}`);
      }
      previousName = vector.name;
    }

    if (vector.tier !== "instance" && vector.tier !== "persistent") {
      errors.push(`${label}.tier must be "instance" or "persistent"`);
    } else {
      tiers.add(vector.tier);
    }

    if (typeof vector.keyVariant !== "string" || vector.keyVariant.length === 0) {
      errors.push(`${label}.keyVariant must be a non-empty string`);
    }
    if (typeof vector.valueType !== "string" || vector.valueType.length === 0) {
      errors.push(`${label}.valueType must be a non-empty string`);
    }
    if (typeof vector.keyXdrHex !== "string" || !HEX_EVEN_PATTERN.test(vector.keyXdrHex)) {
      errors.push(`${label}.keyXdrHex must be non-empty lowercase even-length hex`);
    }
    if (typeof vector.valueXdrHex !== "string" || !HEX_EVEN_PATTERN.test(vector.valueXdrHex)) {
      errors.push(`${label}.valueXdrHex must be non-empty lowercase even-length hex`);
    }
  }

  if (!tiers.has("instance")) {
    errors.push("corpus must include at least one instance storage vector");
  }
  if (!tiers.has("persistent")) {
    errors.push("corpus must include at least one persistent storage vector");
  }

  return errors;
}

export function verifyStorageCorpusLock(lock, readInterfaceFile) {
  const errors = [];
  if (!lock || typeof lock !== "object" || Array.isArray(lock)) {
    return ["storage corpus lock must be a JSON object"];
  }
  if (lock.schema !== "lumenbazaar/storage-corpus-lock") {
    errors.push(`unexpected lock schema ${JSON.stringify(lock.schema)}`);
  }
  if (!Number.isInteger(lock.currentLayoutVersion) || lock.currentLayoutVersion < 1) {
    errors.push("currentLayoutVersion must be a positive integer");
  }
  if (!lock.versions || typeof lock.versions !== "object" || Array.isArray(lock.versions)) {
    errors.push("versions must be an object");
    return errors;
  }

  const currentKey = String(lock.currentLayoutVersion);
  if (!lock.versions[currentKey]) {
    errors.push(`currentLayoutVersion ${currentKey} is missing from versions`);
  }

  for (const [key, entry] of Object.entries(lock.versions)) {
    const version = Number(key);
    if (!Number.isInteger(version) || version < 1 || String(version) !== key) {
      errors.push(`invalid version key ${JSON.stringify(key)}`);
      continue;
    }
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      errors.push(`versions.${key} must be an object`);
      continue;
    }
    const expectedFile = corpusFileName(version);
    if (entry.file !== expectedFile) {
      errors.push(`versions.${key}.file must be ${expectedFile}`);
    }
    if (typeof entry.sha256 !== "string" || !SHA256_PATTERN.test(entry.sha256)) {
      errors.push(`versions.${key}.sha256 must be a 64-character lowercase hex digest`);
    }

    const corpusBytes = readInterfaceFile(expectedFile);
    if (corpusBytes === null) {
      errors.push(`missing corpus file ${expectedFile}`);
    } else {
      const actualSha = sha256Buffer(corpusBytes);
      if (actualSha !== entry.sha256) {
        errors.push(
          `${expectedFile} sha256 mismatch: expected ${entry.sha256}, got ${actualSha} (intentional drift requires a new layout version and migration evidence)`,
        );
      }
      try {
        const parsed = JSON.parse(corpusBytes.toString("utf8"));
        for (const err of verifyStorageCorpusDocument(parsed, version)) {
          errors.push(`${expectedFile}: ${err}`);
        }
      } catch (err) {
        errors.push(`${expectedFile} is not valid JSON: ${err.message}`);
      }
    }

    if (version > 1) {
      if (typeof entry.migrationEvidence !== "string" || entry.migrationEvidence.length === 0) {
        errors.push(`versions.${key}.migrationEvidence is required for storage layout version > 1`);
      } else {
        const migrationBytes = readInterfaceFile(entry.migrationEvidence);
        if (migrationBytes === null) {
          errors.push(`missing migration evidence file ${entry.migrationEvidence}`);
        } else {
          try {
            const migration = JSON.parse(migrationBytes.toString("utf8"));
            if (migration.toInterfaceVersion !== version) {
              errors.push(
                `migration evidence ${entry.migrationEvidence} targets version ${migration.toInterfaceVersion}, expected ${version}`,
              );
            }
          } catch (err) {
            errors.push(`migration evidence ${entry.migrationEvidence} is not valid JSON: ${err.message}`);
          }
        }
      }
    }
  }

  return errors;
}

export function compareStorageCorpusLocks(baseLock, currentLock) {
  if (!baseLock) {
    return [];
  }
  const errors = [];
  if ((currentLock?.currentLayoutVersion ?? 0) < (baseLock.currentLayoutVersion ?? 0)) {
    errors.push(
      `currentLayoutVersion regressed from ${baseLock.currentLayoutVersion} to ${currentLock?.currentLayoutVersion}`,
    );
  }
  for (const [key, baseEntry] of Object.entries(baseLock.versions ?? {})) {
    const currentEntry = currentLock?.versions?.[key];
    if (!currentEntry) {
      errors.push(`locked storage corpus version ${key} was removed`);
      continue;
    }
    if (currentEntry.file !== baseEntry.file || currentEntry.sha256 !== baseEntry.sha256) {
      errors.push(
        `locked storage corpus version ${key} (${baseEntry.file}) was mutated; bump STORAGE_LAYOUT_VERSION and add migration evidence instead`,
      );
    }
  }
  return errors;
}
