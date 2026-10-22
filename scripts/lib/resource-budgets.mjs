// Resource and rent regression guardrails.
//
// The contract records native Soroban cost estimates for one invocation of each
// lifecycle method (`create_session`, `settle`, `cancel`, `recover_expired`,
// `extend_ttl`). Compute cost and storage/rent cost move independently, so the
// report groups the measured fields into a `compute` bucket (instruction and
// memory work) and a `storage` bucket (ledger footprint, TTL bumps, rent bytes,
// event bytes, and the estimated fee) and the guardrails bound each field.

export const LIFECYCLE_OPERATIONS = [
  "create_session",
  "settle",
  "cancel",
  "recover_expired",
  "extend_ttl",
];

// Work the VM does that does not touch ledger entries.
export const COMPUTE_FIELDS = [
  "instructions",
  "mem_bytes",
  "disk_read_entries",
  "memory_read_entries",
  "write_entries",
];

// Ledger footprint, TTL bumps, rent charges, emitted events, and the resulting fee.
export const STORAGE_FIELDS = [
  "disk_read_bytes",
  "write_bytes",
  "contract_events_size_bytes",
  "persistent_rent_ledger_bytes",
  "persistent_entry_rent_bumps",
  "temporary_rent_ledger_bytes",
  "temporary_entry_rent_bumps",
  "estimated_fee_stroops",
];

export const BUDGET_FIELDS = [...COMPUTE_FIELDS, ...STORAGE_FIELDS];

export function budgetCeiling(value, headroomPercent = 25, floor = 0) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Expected a non-negative numeric baseline value, received ${value}`);
  }
  return Math.max(floor, Math.ceil((value * (100 + headroomPercent)) / 100));
}

// Derives a reviewed threshold document from a measured baseline. Native cost
// estimates are deterministic for the pinned SDK, so a ceiling of zero means the
// field must stay zero: any new non-zero value on a previously unused field is a
// behaviour change that needs an intentional threshold update, not a silent pass.
// The committed thresholds are generated once from a reviewed report and then
// edited only with a reviewed measurement.
export function buildThresholds({
  rows,
  headroomPercent = 25,
  reviewedBy = "release-tooling",
  reviewedAt = "2026-10-16",
} = {}) {
  const operations = {};
  for (const row of rows) {
    const ceiling = {};
    for (const field of BUDGET_FIELDS) {
      if (typeof row[field] !== "number") {
        throw new Error(`Baseline row ${row.operation} is missing numeric field ${field}`);
      }
      ceiling[field] = budgetCeiling(row[field], headroomPercent);
    }
    operations[row.operation] = ceiling;
  }
  return {
    reviewedBy,
    reviewedAt,
    headroomPercent,
    methodology:
      "Ceilings are the reviewed native baseline plus headroom. A zero ceiling means the field must stay zero. Update only when a change to the measured behaviour is intentional and reviewed.",
    operations,
  };
}

export function evaluateBudgets({ report, thresholds }) {
  const failures = [];
  if (!Array.isArray(report?.rows)) {
    return { failures: ["resource report does not contain a rows array"], rows: [] };
  }
  const expected = thresholds?.operations ?? {};
  const measured = new Map(report.rows.map((row) => [row.operation, row]));

  for (const operation of LIFECYCLE_OPERATIONS) {
    if (!measured.has(operation)) {
      failures.push(`resource report is missing lifecycle method ${operation}`);
    }
    if (expected[operation] === undefined) {
      failures.push(`thresholds define no ceiling for lifecycle method ${operation}`);
    }
  }

  const rows = [];
  for (const [operation, ceiling] of Object.entries(expected)) {
    const row = measured.get(operation);
    if (row === undefined) {
      continue;
    }
    const compute = {};
    const storage = {};
    for (const field of COMPUTE_FIELDS) {
      compute[field] = row[field];
    }
    for (const field of STORAGE_FIELDS) {
      storage[field] = row[field];
    }
    for (const [field, max] of Object.entries(ceiling)) {
      const observed = row[field];
      if (typeof observed !== "number") {
        failures.push(`${operation}.${field} is not measured in the resource report`);
        continue;
      }
      if (observed > max) {
        failures.push(
          `${operation}.${field} regressed: observed ${observed} exceeds reviewed ceiling ${max}`,
        );
      }
    }
    rows.push({
      operation,
      compute,
      storage,
      storageLedgerBytes:
        (row.persistent_rent_ledger_bytes ?? 0) + (row.temporary_rent_ledger_bytes ?? 0),
      storageRentBumps:
        (row.persistent_entry_rent_bumps ?? 0) + (row.temporary_entry_rent_bumps ?? 0),
    });
  }

  return { failures, rows };
}
