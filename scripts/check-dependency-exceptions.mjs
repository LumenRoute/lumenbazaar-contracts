import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  validateAdvisoryExceptions,
  validateCargoDenyExceptions,
  validateDenyTomlAlignment,
} from "./lib/dependency-exceptions.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const advisoryManifest = JSON.parse(
  readFileSync(join(repoRoot, "audits", "dependency-exceptions.json"), "utf8"),
);
const denyManifest = JSON.parse(
  readFileSync(join(repoRoot, "audits", "cargo-deny-exceptions.json"), "utf8"),
);
const denyToml = readFileSync(join(repoRoot, "deny.toml"), "utf8");

const advisoryIds = validateAdvisoryExceptions(advisoryManifest);
const denyCrateIds = validateCargoDenyExceptions(denyManifest);
validateDenyTomlAlignment(denyToml, advisoryIds, denyCrateIds);

console.log(
  `Validated ${advisoryIds.size} advisory exception(s) and ${denyCrateIds.size} cargo-deny exception(s).`,
);
