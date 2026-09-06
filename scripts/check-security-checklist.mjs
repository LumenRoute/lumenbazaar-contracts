import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const checklist = readFileSync(join(repoRoot, "docs", "security-checklist.md"), "utf8");
const tests = readFileSync(
  join(repoRoot, "contracts", "upto-session", "src", "test.rs"),
  "utf8",
);
const validation = readFileSync(
  join(repoRoot, "contracts", "upto-session", "src", "validation.rs"),
  "utf8",
);

const controls = [
  {
    name: "Authorization boundaries",
    tests: [
      "initialize_stores_admin_once",
      "create_session_requires_buyer_auth",
      "settle_requires_seller_auth",
      "settle_rejects_wrong_seller_auth",
      "cancel_requires_buyer_auth",
    ],
  },
  {
    name: "Cap enforcement",
    tests: ["settle_rejects_invalid_amounts_and_expiry", "rejects_invalid_settlement_amounts"],
  },
  {
    name: "Double-settlement prevention",
    tests: [
      "settle_prevents_double_settlement",
      "settle_rejects_finalized_sessions",
      "cancel_rejects_already_settled_session",
    ],
  },
  {
    name: "Expiry handling",
    tests: [
      "rejects_expired_sessions",
      "rejects_settlement_at_or_after_expiry",
      "expired_open_session_remains_observable_and_buyer_cancellable",
    ],
  },
  {
    name: "Asset and seller binding",
    tests: ["rejects_invalid_seller_or_asset_bindings", "invalid_create_inputs_do_not_consume_sequence"],
  },
  {
    name: "Event correctness",
    tests: [
      "create_session_emits_stable_event",
      "settle_emits_stable_event",
      "cancel_emits_stable_event",
    ],
  },
];

for (const control of controls) {
  if (!checklist.includes(control.name)) {
    throw new Error(`Checklist is missing ${control.name}`);
  }
  for (const test of control.tests) {
    if (!checklist.includes(test)) {
      throw new Error(`Checklist does not cite ${test}`);
    }
    if (!tests.includes(test) && !validation.includes(test)) {
      throw new Error(`Cited test does not exist: ${test}`);
    }
  }
}

console.log("security checklist check passed");
