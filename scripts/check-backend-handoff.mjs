import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const handoff = readFileSync(
  join(repoRoot, "docs", "backend-integration-handoff.md"),
  "utf8",
);
const hashes = JSON.parse(
  readFileSync(
    join(repoRoot, "artifacts", "backend-handoff", "usage-hashes.example.json"),
    "utf8",
  ),
);

const requiredFunctions = [
  "initialize",
  "create_session",
  "get_session",
  "settle",
  "cancel",
  "extend_ttl",
];
const requiredErrors = [
  "AlreadyInitialized",
  "Unauthorized",
  "InvalidAmount",
  "ExpiredSession",
  "SessionNotFound",
  "SessionAlreadySettled",
  "SessionCancelled",
  "AmountExceedsCap",
  "InvalidAsset",
  "InvalidSeller",
  "TtlExtensionFailed",
  "InvalidResourceHash",
  "InvalidUsageHash",
];

for (const item of [...requiredFunctions, ...requiredErrors]) {
  if (!handoff.includes(item)) {
    throw new Error(`Backend handoff is missing ${item}`);
  }
}

assertHash(
  hashes.resourceDescriptorCanonicalJson,
  hashes.resourceHashHex,
  "resourceHashHex",
);
assertHash(hashes.usageReceiptCanonicalJson, hashes.usageHashHex, "usageHashHex");

console.log("backend handoff check passed");

function assertHash(input, expected, label) {
  const actual = createHash("sha256").update(input, "utf8").digest("hex");
  if (actual !== expected || !/^[0-9a-f]{64}$/.test(expected)) {
    throw new Error(`Invalid ${label}`);
  }
}
