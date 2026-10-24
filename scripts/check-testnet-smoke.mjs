import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { validateReport } from "./lib/testnet-smoke.mjs";

const path = process.argv[2];
if (!path) {
  throw new Error("Usage: node scripts/check-testnet-smoke.mjs <smoke-report.json>");
}

validateReport(JSON.parse(readFileSync(resolve(path), "utf8")));
console.log("testnet smoke report is complete, sanitized, and value-conserving");
