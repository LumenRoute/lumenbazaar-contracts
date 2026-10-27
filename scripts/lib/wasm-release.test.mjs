// Tests for the reproducible testnet WASM release logic. Synthetic fixtures;
// the committed 2026-09-06 manifest is only read.
//   node --test scripts/lib/wasm-release.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  STELLAR_CLI_PINS,
  buildChecksums,
  manifestPathForTag,
  parseReviewedMismatches,
  releaseExpectations,
  renderReleaseNotes,
  stellarCliPin,
  verifyArtifacts,
  verifyTagObject,
  wasmFileName,
} from "./wasm-release.mjs";

const MANIFEST = "deployments/testnet-2030-01-01.json";
const COMMIT = "1".repeat(40);
const hash = (byte) => byte.repeat(64);

function manifest(overrides = {}) {
  return {
    environment: "testnet",
    sourceCommit: COMMIT,
    toolchain: { rustc: "1.93.1", stellarCli: "27.1.0" },
    contracts: {
      "upto-session": { artifactSha256: hash("a") },
      "test-token": { artifactSha256: hash("b") },
    },
    ...overrides,
  };
}

const expectations = () => releaseExpectations(manifest(), MANIFEST);
const built = (overrides = {}) =>
  [
    { name: "test_token.wasm", sha256: hash("b"), size: 2 },
    { name: "upto_session.wasm", sha256: hash("a"), size: 1 },
    ...(overrides.extra ?? []),
  ].map((artifact) => ({ ...artifact, ...(overrides[artifact.name] ?? {}) }));

function reviewedFile(entries) {
  return { schemaVersion: 1, manifest: MANIFEST, entries };
}
const mismatchEntry = (overrides = {}) => ({
  kind: "hash-mismatch",
  artifact: "upto_session.wasm",
  recordedSha256: hash("a"),
  reproducedSha256: hash("c"),
  reason: "Synthetic example: the recorded build embedded a different CLI metadata section.",
  reviewedBy: "@reviewer",
  reviewedAt: "2030-01-02",
  reviewUrl: "https://github.com/LumenRoute/lumenbazaar-contracts/pull/1",
  ...overrides,
});

test("all recorded hashes reproduced", () => {
  const result = verifyArtifacts(expectations(), built());
  assert.equal(result.ok, true);
  assert.equal(result.verification, "all-recorded-hashes-reproduced");
  assert.deepEqual(result.published.map((r) => r.name), ["test_token.wasm", "upto_session.wasm"]);
});

test("an unreviewed mismatch fails and publishes nothing", () => {
  const result = verifyArtifacts(expectations(), built({ "upto_session.wasm": { sha256: hash("c") } }));
  assert.equal(result.ok, false);
  assert.equal(result.verification, "failed");
  assert.match(result.errors.join(), /upto_session\.wasm: reproduced c+ but .* records a+; no reviewed explanation/);
  assert.throws(() => buildChecksums({ verification: result, expectations: expectations() }), /refusing/);
});

test("a reviewed mismatch for the exact artifact and hashes is accepted and labelled", () => {
  const reviewed = parseReviewedMismatches(reviewedFile([mismatchEntry()]), MANIFEST, "r.json");
  const result = verifyArtifacts(expectations(), built({ "upto_session.wasm": { sha256: hash("c") } }), reviewed);
  assert.equal(result.ok, true);
  assert.equal(result.verification, "matched-with-reviewed-mismatches");
  assert.equal(result.published.find((r) => r.name === "upto_session.wasm").status, "reviewed-mismatch");
});

test("a reviewed mismatch for different hashes is never auto-accepted", () => {
  const reviewed = parseReviewedMismatches(reviewedFile([mismatchEntry()]), MANIFEST, "r.json");
  const result = verifyArtifacts(expectations(), built({ "upto_session.wasm": { sha256: hash("d") } }), reviewed);
  assert.equal(result.ok, false);
  assert.match(result.errors.join(), /does not cover these exact hashes/);
});

test("a reviewed entry that does not apply fails", () => {
  const reviewed = parseReviewedMismatches(reviewedFile([mismatchEntry()]), MANIFEST, "r.json");
  assert.match(verifyArtifacts(expectations(), built(), reviewed).errors.join(), /does not apply/);
});

test("a missing artifact fails", () => {
  const result = verifyArtifacts(expectations(), built().filter((a) => a.name !== "test_token.wasm"));
  assert.equal(result.ok, false);
  assert.match(result.errors.join(), /test_token\.wasm: recorded .* but not produced/);
});

test("an extra unrecorded artifact fails unless explicitly excluded by review", () => {
  const extra = { name: "policy_wallet_example.wasm", sha256: hash("e"), size: 3 };
  const result = verifyArtifacts(expectations(), built({ extra: [extra] }));
  assert.equal(result.ok, false);
  assert.match(result.errors.join(), /unrecorded artifacts are never published/);

  const reviewed = parseReviewedMismatches(
    reviewedFile([
      {
        kind: "excluded-unrecorded-artifact",
        artifact: "policy_wallet_example.wasm",
        reproducedSha256: hash("e"),
        reason: "Synthetic example: example contract built by the workspace but not deployed.",
        reviewedBy: "@reviewer",
        reviewedAt: "2030-01-02",
        reviewUrl: "https://github.com/LumenRoute/lumenbazaar-contracts/pull/2",
      },
    ]),
    MANIFEST,
    "r.json",
  );
  const excluded = verifyArtifacts(expectations(), built({ extra: [extra] }), reviewed);
  assert.equal(excluded.ok, true);
  assert.equal(excluded.published.some((r) => r.name === "policy_wallet_example.wasm"), false);
});

for (const [name, change] of [
  ["non-testnet environment", { environment: "pubnet" }],
  ["missing environment", { environment: undefined }],
  ["short source commit", { sourceCommit: "95ea327" }],
  ["missing toolchain", { toolchain: undefined }],
  ["inexact rustc", { toolchain: { rustc: "stable", stellarCli: "27.1.0" } }],
  ["missing contracts", { contracts: {} }],
  ["malformed artifact hash", { contracts: { "upto-session": { artifactSha256: "ABC" } } }],
  ["wrong target", { toolchain: { rustc: "1.93.1", stellarCli: "27.1.0", target: "wasm32-unknown-unknown" } }],
]) {
  test(`a malformed manifest (${name}) is rejected`, () => {
    assert.throws(() => releaseExpectations(manifest(change), MANIFEST));
  });
}

test("manifests outside deployments/testnet-YYYY-MM-DD.json are rejected", () => {
  assert.throws(() => releaseExpectations(manifest(), "deployments/pubnet.json"), /testnet-YYYY-MM-DD/);
  assert.throws(() => releaseExpectations([], MANIFEST), /JSON object/);
});

for (const [name, document] of [
  ["wrong schema version", { ...reviewedFile([mismatchEntry()]), schemaVersion: 2 }],
  ["wrong manifest", { ...reviewedFile([mismatchEntry()]), manifest: "deployments/other.json" }],
  ["extra top-level key", { ...reviewedFile([mismatchEntry()]), approved: true }],
  ["empty entries", reviewedFile([])],
  ["unknown kind", reviewedFile([mismatchEntry({ kind: "accept-anything" })])],
  ["missing reason", reviewedFile([(({ reason, ...rest }) => rest)(mismatchEntry())])],
  ["short reason", reviewedFile([mismatchEntry({ reason: "differs" })])],
  ["bad hash", reviewedFile([mismatchEntry({ reproducedSha256: "XYZ" })])],
  ["bad reviewer", reviewedFile([mismatchEntry({ reviewedBy: "someone" })])],
  ["bad date", reviewedFile([mismatchEntry({ reviewedAt: "yesterday" })])],
  ["no review link", reviewedFile([mismatchEntry({ reviewUrl: "https://example.test/ok" })])],
  ["duplicate artifact", reviewedFile([mismatchEntry(), mismatchEntry()])],
  ["extra entry key", reviewedFile([{ ...mismatchEntry(), autoAccept: true }])],
]) {
  test(`a malformed reviewed-mismatch file (${name}) is rejected`, () => {
    assert.throws(() => parseReviewedMismatches(document, MANIFEST, "r.json"));
  });
}

test("checksums are deterministic, labelled TESTNET and carry source metadata", () => {
  const input = {
    tag: "testnet-wasm-2030-01-01",
    tagCommit: "2".repeat(40),
    manifestPath: MANIFEST,
    manifestSha256: hash("f"),
    expectations: expectations(),
    sourceCommitTimestamp: "2030-01-01T00:00:00+00:00",
    cargoLockSha256: hash("9"),
    rustcVersion: "rustc 1.93.1 (01f6ddf75 2026-02-11)",
    stellarCliVersion: "stellar 27.1.0 (8e402ea28202950b272fbabc34caad4d2f64fe87)",
    verification: verifyArtifacts(expectations(), built()),
  };
  const first = buildChecksums(input);
  assert.equal(first.json, buildChecksums(input).json);
  const document = JSON.parse(first.json);
  assert.match(document.label, /TESTNET/);
  assert.match(document.label, /not a production/);
  assert.equal(document.source.commit, COMMIT);
  assert.equal(document.source.cargoLockSha256, hash("9"));
  assert.equal(document.toolchain.rustc, "1.93.1");
  assert.equal(document.toolchain.stellarCli, "27.1.0");
  assert.equal(document.toolchain.stellarCliArchiveSha256, STELLAR_CLI_PINS["27.1.0"].sha256);
  assert.equal(document.verification.result, "all-recorded-hashes-reproduced");
  assert.equal(document.artifacts.find((a) => a.contract === "test-token").note, "LBT custom test-only token; not USDC");
  assert.ok(document.limitations.some((line) => /not USDC/.test(line)));
  assert.equal(first.sums, `${hash("b")}  test_token.wasm\n${hash("a")}  upto_session.wasm\n`);
  assert.match(renderReleaseNotes(first), /not a production or mainnet release/);
  assert.doesNotMatch(first.json, /generatedAt|"now"/);
});

test("tag names map only to dated testnet manifests", () => {
  assert.equal(manifestPathForTag("testnet-wasm-2026-09-06"), "deployments/testnet-2026-09-06.json");
  for (const tag of ["v1.0.0", "testnet-wasm-latest", "testnet-wasm-2026-09-06;rm", "pubnet-wasm-2026-09-06"]) {
    assert.throws(() => manifestPathForTag(tag));
  }
});

test("only reviewed Stellar CLI archives can be installed", () => {
  assert.match(stellarCliPin("27.1.0").url, /v27\.1\.0\/stellar-cli-27\.1\.0-x86_64-unknown-linux-gnu\.tar\.gz$/);
  assert.throws(() => stellarCliPin("29.0.0"), /no reviewed archive pin/);
});

const signedTag = {
  tagName: "testnet-wasm-2026-09-06",
  expectedCommit: COMMIT,
  ref: { object: { type: "tag", sha: "3".repeat(40) } },
  tagObject: { tag: "testnet-wasm-2026-09-06", object: { type: "commit", sha: COMMIT }, verification: { verified: true, reason: "valid" } },
};

test("an annotated, GitHub-verified tag on the checked-out commit passes", () => {
  assert.deepEqual(verifyTagObject(signedTag), []);
});

for (const [name, change, pattern] of [
  ["lightweight tag", { ref: { object: { type: "commit", sha: COMMIT } } }, /lightweight/],
  ["unresolvable ref", { ref: undefined }, /not resolvable/],
  ["unsigned tag", { tagObject: { ...signedTag.tagObject, verification: { verified: false, reason: "unsigned" } } }, /not verified.*unsigned/],
  ["missing verification", { tagObject: { ...signedTag.tagObject, verification: undefined } }, /not verified/],
  ["tag on another commit", { tagObject: { ...signedTag.tagObject, object: { type: "commit", sha: "4".repeat(40) } } }, /does not point/],
  ["tag of a tag", { tagObject: { ...signedTag.tagObject, object: { type: "tag", sha: COMMIT } } }, /does not point/],
  ["name mismatch", { tagObject: { ...signedTag.tagObject, tag: "testnet-wasm-2026-09-07" } }, /name does not match/],
  ["non-release tag name", { tagName: "v9.9.9" }, /must match/],
]) {
  test(`tag verification fails closed: ${name}`, () => {
    assert.match(verifyTagObject({ ...signedTag, ...change }).join("\n"), pattern);
  });
}

test("the committed 2026-09-06 manifest yields exact, unmodified expectations", () => {
  const path = "deployments/testnet-2026-09-06.json";
  const parsed = JSON.parse(readFileSync(new URL(`../../${path}`, import.meta.url), "utf8"));
  const expected = releaseExpectations(parsed, path);
  assert.equal(expected.sourceCommit, "95ea3270b8a5cb052fee5dd9402ed19dbd5a9001");
  assert.equal(expected.rustc, "1.93.1");
  assert.equal(expected.stellarCli, "27.1.0");
  assert.deepEqual(Object.keys(expected.artifacts).sort(), [
    "policy_wallet_example.wasm",
    "test_token.wasm",
    "upto_session.wasm",
  ]);
  assert.equal(expected.artifacts["upto_session.wasm"].sha256, parsed.contracts["upto-session"].artifactSha256);
  assert.equal(wasmFileName("policy-wallet-example"), "policy_wallet_example.wasm");
});
