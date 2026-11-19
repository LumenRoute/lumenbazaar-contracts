import test from "node:test";
import assert from "node:assert/strict";
import {
  validateAdvisoryExceptions,
  validateCargoDenyExceptions,
  validateDenyTomlAlignment,
} from "./dependency-exceptions.mjs";

const TODAY = new Date("2026-11-19T00:00:00Z");

const SAMPLE_DENY_TOML = `
[advisories]
ignore = [{ id = "RUSTSEC-2024-0436", reason = "tracked" }]

[licenses]
unused-allowed-license = "deny"

[bans]
multiple-versions = "deny"
wildcards = "deny"
skip = [{ crate = "syn@2.0.119", reason = "tracked" }]

[sources]
unknown-registry = "deny"
unknown-git = "deny"
`;

test("accepts aligned non-expired advisory and cargo-deny exceptions", () => {
  const advisoryIds = validateAdvisoryExceptions(
    {
      schemaVersion: 1,
      exceptions: [
        {
          advisory: "RUSTSEC-2024-0436",
          package: "paste 1.0.15",
          classification: "unmaintained",
          owner: "contracts-maintainers",
          expiresOn: "2027-05-19",
          dependencyPath: "soroban-sdk -> paste",
          resolution: "Remove on SDK upgrade",
          risk: "Unmaintained warning only",
        },
      ],
    },
    TODAY,
  );
  const denyCrateIds = validateCargoDenyExceptions(
    {
      schemaVersion: 1,
      exceptions: [
        {
          crate: "syn@2.0.119",
          category: "duplicate-version",
          owner: "contracts-maintainers",
          expiresOn: "2027-05-19",
          dependencyPath: "soroban-sdk-macros -> syn 2.0.119",
          justification: "Compile-time proc-macro parser split",
          resolution: "Remove once soroban-sdk-macros upgrades to syn 3",
        },
      ],
    },
    TODAY,
  );
  validateDenyTomlAlignment(SAMPLE_DENY_TOML, advisoryIds, denyCrateIds);
});

test("rejects unpinned crate names without exact version", () => {
  assert.throws(
    () =>
      validateCargoDenyExceptions(
        {
          schemaVersion: 1,
          exceptions: [
            {
              crate: "syn",
              category: "duplicate-version",
              owner: "contracts-maintainers",
              expiresOn: "2027-05-19",
              dependencyPath: "soroban-sdk-macros -> syn",
              justification: "blanket",
              resolution: "later",
            },
          ],
        },
        TODAY,
      ),
    /exact name@version/,
  );
});

test("rejects expired cargo-deny exceptions", () => {
  assert.throws(
    () =>
      validateCargoDenyExceptions(
        {
          schemaVersion: 1,
          exceptions: [
            {
              crate: "syn@2.0.119",
              category: "duplicate-version",
              owner: "contracts-maintainers",
              expiresOn: "2026-11-18",
              dependencyPath: "soroban-sdk-macros -> syn 2.0.119",
              justification: "split",
              resolution: "upgrade",
            },
          ],
        },
        TODAY,
      ),
    /expired on 2026-11-18/,
  );
});

test("rejects undocumented skip entry in deny.toml", () => {
  assert.throws(
    () =>
      validateDenyTomlAlignment(
        SAMPLE_DENY_TOML,
        new Set(["RUSTSEC-2024-0436"]),
        new Set(),
      ),
    /skips crate syn@2.0.119 without a matching record/,
  );
});

test("rejects stale exception record missing from deny.toml", () => {
  assert.throws(
    () =>
      validateDenyTomlAlignment(
        SAMPLE_DENY_TOML,
        new Set(["RUSTSEC-2024-0436"]),
        new Set(["syn@2.0.119", "digest@0.10.7"]),
      ),
    /stale record digest@0.10.7/,
  );
});
