import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzeContractSource,
  validateErrorSurfaceMatrix,
} from "./error-surface-matrix.mjs";

const MINI_ERRORS = `
pub enum ContractError {
    AlreadyInitialized = 1,
    Unauthorized = 2,
    InvalidBatchSize = 31,
    EscrowUnderfunded = 19,
}
`;

const MINI_LIB = `
impl UptoSessionContract {
    pub fn initialize(env: Env, admin: Address) -> Result<(), ContractError> {
        if has_admin(&env) {
            return Err(ContractError::AlreadyInitialized);
        }
        admin.require_auth();
        Ok(())
    }

    pub fn recover_expired_batch(env: Env, ids: Vec<BytesN<32>>) -> Result<(), ContractError> {
        if ids.is_empty() {
            return Err(ContractError::InvalidBatchSize);
        }
        match recover_open(&env) {
            Ok(()) => Ok(()),
            Err(ContractError::EscrowUnderfunded) => Ok(()),
            Err(error) => Err(error),
        }
    }
}

fn recover_open(env: &Env) -> Result<(), ContractError> {
    Err(ContractError::EscrowUnderfunded)
}
`;

test("caught errors in match arms are excluded from escaped method edges", () => {
  const result = analyzeContractSource({
    libSource: MINI_LIB,
    validationSource: "",
    storageSource: "",
    errorsSource: MINI_ERRORS,
  });
  assert.deepEqual(result.methods.initialize.errors, ["AlreadyInitialized", "Unauthorized"]);
  assert.equal(result.methods.initialize.authorizationEnforced, true);
  assert.deepEqual(result.methods.recover_expired_batch.errors, ["InvalidBatchSize"]);
  assert.equal(result.methods.recover_expired_batch.authorizationEnforced, false);
});

test("detects undocumented new error edges", () => {
  const expected = {
    schemaVersion: 1,
    errors: [
      {
        error: "InvalidAmount",
        code: 3,
        category: "validation",
        methods: ["settle"],
        tests: ["test_invalid_amount"],
        handoff: "Reject invalid amounts.",
      },
    ],
    methods: [
      {
        method: "settle",
        authorizationEnforced: true,
        errors: [
          {
            error: "InvalidAmount",
            code: 3,
            category: "validation",
            hostEnforced: false,
            tests: ["test_invalid_amount"],
            handoff: "Reject invalid amounts.",
          },
        ],
      },
    ],
  };
  const committed = {
    ...expected,
    methods: [{ method: "settle", authorizationEnforced: true, errors: [] }],
  };
  const issues = validateErrorSurfaceMatrix(committed, expected, new Set(["test_invalid_amount"]));
  assert.ok(issues.some((i) => i.includes("Undocumented source error edge: settle::InvalidAmount")));
});

test("detects unreachable claimed error edges and missing tests", () => {
  const expected = {
    schemaVersion: 1,
    errors: [
      {
        error: "InvalidAmount",
        code: 3,
        category: "validation",
        methods: ["settle"],
        tests: ["test_invalid_amount"],
        handoff: "Reject invalid amounts.",
      },
    ],
    methods: [
      {
        method: "settle",
        authorizationEnforced: true,
        errors: [
          {
            error: "InvalidAmount",
            code: 3,
            category: "validation",
            hostEnforced: false,
            tests: ["test_invalid_amount"],
            handoff: "Reject invalid amounts.",
          },
        ],
      },
    ],
  };
  const committed = {
    ...expected,
    errors: [
      {
        error: "InvalidAmount",
        code: 3,
        category: "validation",
        methods: ["settle"],
        tests: ["nonexistent_test"],
        handoff: "Reject invalid amounts.",
      },
    ],
    methods: [
      {
        method: "settle",
        authorizationEnforced: true,
        errors: [
          ...expected.methods[0].errors,
          {
            error: "AlreadyInitialized",
            code: 1,
            category: "state",
            hostEnforced: false,
            tests: ["test_invalid_amount"],
            handoff: "Stale claim.",
          },
        ],
      },
    ],
  };
  const issues = validateErrorSurfaceMatrix(committed, expected, new Set(["test_invalid_amount"]));
  assert.ok(issues.some((i) => i.includes("missing Rust test: nonexistent_test")));
  assert.ok(issues.some((i) => i.includes("Unreachable or stale error edge in matrix: settle::AlreadyInitialized")));
});
