import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const exceptionPath = join(repoRoot, "audits", "dependency-exceptions.json");
const manifest = JSON.parse(readFileSync(exceptionPath, "utf8"));
const requiredFields = [
  "advisory",
  "package",
  "classification",
  "owner",
  "expiresOn",
  "dependencyPath",
  "resolution",
  "risk",
];

if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.exceptions)) {
  throw new Error("Dependency exception manifest must use schemaVersion 1 and contain an exceptions array.");
}

const today = new Date();
today.setUTCHours(0, 0, 0, 0);
const advisories = new Set();

for (const exception of manifest.exceptions) {
  for (const field of requiredFields) {
    if (typeof exception[field] !== "string" || exception[field].trim() === "") {
      throw new Error(`Dependency exception is missing ${field}.`);
    }
  }

  if (advisories.has(exception.advisory)) {
    throw new Error(`Duplicate dependency exception: ${exception.advisory}`);
  }
  advisories.add(exception.advisory);

  const expiry = new Date(`${exception.expiresOn}T00:00:00Z`);
  if (Number.isNaN(expiry.getTime())) {
    throw new Error(`Invalid expiry for ${exception.advisory}: ${exception.expiresOn}`);
  }
  if (expiry < today) {
    throw new Error(`Dependency exception ${exception.advisory} expired on ${exception.expiresOn}.`);
  }
}

console.log(`Validated ${manifest.exceptions.length} dependency audit exception(s).`);
