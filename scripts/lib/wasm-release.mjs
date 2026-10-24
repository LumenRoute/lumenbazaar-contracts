// Verification logic for reproducible testnet WASM releases.
//
// A release reproduces the WASM recorded in one immutable testnet deployment
// manifest: same source commit, same locked dependencies, same Rust and
// Stellar CLI versions and the same `stellar contract build --locked` process.
// Every built artifact must match its recorded SHA-256, or be covered by a
// reviewed explanation committed under deployments/reviewed-mismatches/.
import { createHash } from "node:crypto";

export const RELEASE_TAG_PATTERN = /^testnet-wasm-(\d{4}-\d{2}-\d{2})$/;
export const MANIFEST_PATH_PATTERN = /^deployments\/testnet-(\d{4}-\d{2}-\d{2})\.json$/;
export const BUILD_COMMAND = ["stellar", "contract", "build", "--locked"];
export const WASM_TARGET = "wasm32v1-none";

/**
 * Reviewed Stellar CLI release archives (x86_64 Linux). Hashes match the
 * digests GitHub publishes for github.com/stellar/stellar-cli releases. Add a
 * version only through review; unknown versions are refused.
 */
export const STELLAR_CLI_PINS = Object.freeze({
  "27.1.0": {
    url: "https://github.com/stellar/stellar-cli/releases/download/v27.1.0/stellar-cli-27.1.0-x86_64-unknown-linux-gnu.tar.gz",
    sha256: "9915fe63753d7154c26bb9e6410cf1d1ff9727a9b378e663c2790ab7a266af94",
  },
  "28.0.0": {
    url: "https://github.com/stellar/stellar-cli/releases/download/v28.0.0/stellar-cli-28.0.0-x86_64-unknown-linux-gnu.tar.gz",
    sha256: "207544486734fccb4df1afc4a7745478f9f1e21688b2f9506f0ef36f60ce3fdc",
  },
});

const SHA256 = /^[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const VERSION = /^\d+\.\d+\.\d+$/;
const REVIEWED_ENTRY_KEYS = {
  "hash-mismatch": ["kind", "artifact", "recordedSha256", "reproducedSha256", "reason", "reviewedBy", "reviewedAt", "reviewUrl"],
  "excluded-unrecorded-artifact": ["kind", "artifact", "reproducedSha256", "reason", "reviewedBy", "reviewedAt", "reviewUrl"],
};

export function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function manifestPathForTag(tag) {
  const match = RELEASE_TAG_PATTERN.exec(String(tag));
  if (match === null) {
    throw new Error(`release tag ${JSON.stringify(tag)} must match testnet-wasm-YYYY-MM-DD`);
  }
  return `deployments/testnet-${match[1]}.json`;
}

export function wasmFileName(contract) {
  return `${contract.replaceAll("-", "_")}.wasm`;
}

export function stellarCliPin(version) {
  const pin = STELLAR_CLI_PINS[version];
  if (pin === undefined) {
    throw new Error(
      `Stellar CLI ${version} has no reviewed archive pin; refusing to download an unpinned tool`,
    );
  }
  return pin;
}

/** Validates a deployment manifest and returns what the release must reproduce. */
export function releaseExpectations(manifest, manifestPath) {
  const errors = [];
  if (!MANIFEST_PATH_PATTERN.test(manifestPath)) {
    errors.push(`${manifestPath}: release manifests must be deployments/testnet-YYYY-MM-DD.json`);
  }
  if (typeof manifest !== "object" || manifest === null || Array.isArray(manifest)) {
    throw new Error(`${manifestPath}: manifest must be a JSON object`);
  }
  if (manifest.environment !== "testnet") {
    errors.push(`${manifestPath}: environment must be "testnet"; this workflow only publishes testnet releases`);
  }
  if (!COMMIT.test(manifest.sourceCommit ?? "")) {
    errors.push(`${manifestPath}: sourceCommit must be a full 40-character commit SHA`);
  }
  const toolchain = manifest.toolchain ?? {};
  if (!VERSION.test(toolchain.rustc ?? "")) {
    errors.push(`${manifestPath}: toolchain.rustc must be an exact x.y.z version`);
  }
  if (!VERSION.test(toolchain.stellarCli ?? "")) {
    errors.push(`${manifestPath}: toolchain.stellarCli must be an exact x.y.z version`);
  }
  if (toolchain.target !== undefined && toolchain.target !== WASM_TARGET) {
    errors.push(`${manifestPath}: toolchain.target must be ${WASM_TARGET}`);
  }
  const artifacts = {};
  const contracts = manifest.contracts;
  if (typeof contracts !== "object" || contracts === null || Object.keys(contracts).length === 0) {
    errors.push(`${manifestPath}: contracts must record at least one artifact`);
  } else {
    for (const [contract, record] of Object.entries(contracts)) {
      if (!SHA256.test(record?.artifactSha256 ?? "")) {
        errors.push(`${manifestPath}: contracts.${contract}.artifactSha256 must be 64 lowercase hex characters`);
        continue;
      }
      artifacts[wasmFileName(contract)] = { contract, sha256: record.artifactSha256 };
    }
  }
  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }
  return {
    manifestPath,
    sourceCommit: manifest.sourceCommit,
    rustc: toolchain.rustc,
    stellarCli: toolchain.stellarCli,
    artifacts,
  };
}

/** Parses and validates a reviewed-mismatch file. Throws on any deviation. */
export function parseReviewedMismatches(document, manifestPath, source) {
  const fail = (message) => {
    throw new Error(`${source}: ${message}`);
  };
  if (typeof document !== "object" || document === null || Array.isArray(document)) {
    fail("must be a JSON object");
  }
  if (!sameKeys(document, ["schemaVersion", "manifest", "entries"])) {
    fail("must contain exactly schemaVersion, manifest and entries");
  }
  if (document.schemaVersion !== 1) {
    fail("schemaVersion must be 1");
  }
  if (document.manifest !== manifestPath) {
    fail(`manifest must be ${manifestPath}`);
  }
  if (!Array.isArray(document.entries) || document.entries.length === 0) {
    fail("entries must be a non-empty array");
  }
  const seen = new Set();
  return document.entries.map((entry, index) => {
    const at = `entries[${index}]`;
    const keys = REVIEWED_ENTRY_KEYS[entry?.kind];
    if (keys === undefined) {
      fail(`${at}.kind must be one of ${Object.keys(REVIEWED_ENTRY_KEYS).join(", ")}`);
    }
    if (!sameKeys(entry, keys)) {
      fail(`${at} must contain exactly ${keys.join(", ")}`);
    }
    if (!/^[a-z0-9_]+\.wasm$/.test(entry.artifact)) {
      fail(`${at}.artifact must be a WASM file name`);
    }
    if (seen.has(entry.artifact)) {
      fail(`${at}.artifact ${entry.artifact} is listed twice`);
    }
    seen.add(entry.artifact);
    for (const field of ["recordedSha256", "reproducedSha256"]) {
      if (field in entry && !SHA256.test(entry[field])) {
        fail(`${at}.${field} must be 64 lowercase hex characters`);
      }
    }
    if (typeof entry.reason !== "string" || entry.reason.trim().length < 40) {
      fail(`${at}.reason must explain the difference in at least 40 characters`);
    }
    if (typeof entry.reviewedBy !== "string" || !/^@[A-Za-z0-9-]+$/.test(entry.reviewedBy)) {
      fail(`${at}.reviewedBy must be a GitHub handle such as @maintainer`);
    }
    if (typeof entry.reviewedAt !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(entry.reviewedAt)) {
      fail(`${at}.reviewedAt must be YYYY-MM-DD`);
    }
    if (
      typeof entry.reviewUrl !== "string" ||
      !/^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/(pull|issues)\/\d+$/.test(entry.reviewUrl)
    ) {
      fail(`${at}.reviewUrl must link the reviewed GitHub pull request or issue`);
    }
    return entry;
  });
}

/**
 * Compares built artifacts with the manifest. Never edits the manifest and
 * never accepts a mismatch that is not reviewed for that exact artifact and
 * pair of hashes.
 */
export function verifyArtifacts(expectations, built, reviewed = []) {
  const results = [];
  const errors = [];
  const builtByName = new Map(built.map((artifact) => [artifact.name, artifact]));
  const reviewedByName = new Map(reviewed.map((entry) => [entry.artifact, entry]));
  const usedReviews = new Set();

  for (const [name, expected] of Object.entries(expectations.artifacts)) {
    const artifact = builtByName.get(name);
    if (artifact === undefined) {
      results.push({ name, contract: expected.contract, recordedSha256: expected.sha256, status: "missing" });
      errors.push(`${name}: recorded in ${expectations.manifestPath} but not produced by the build`);
      continue;
    }
    const base = {
      name,
      contract: expected.contract,
      recordedSha256: expected.sha256,
      sha256: artifact.sha256,
      size: artifact.size,
    };
    if (artifact.sha256 === expected.sha256) {
      results.push({ ...base, status: "match" });
      continue;
    }
    const review = reviewedByName.get(name);
    if (
      review?.kind === "hash-mismatch" &&
      review.recordedSha256 === expected.sha256 &&
      review.reproducedSha256 === artifact.sha256
    ) {
      usedReviews.add(name);
      results.push({ ...base, status: "reviewed-mismatch", review: review.reviewUrl });
      continue;
    }
    results.push({ ...base, status: "mismatch" });
    errors.push(
      `${name}: reproduced ${artifact.sha256} but ${expectations.manifestPath} records ${expected.sha256}` +
        (review === undefined ? "; no reviewed explanation exists" : "; the reviewed explanation does not cover these exact hashes"),
    );
  }

  for (const artifact of built) {
    if (expectations.artifacts[artifact.name] !== undefined) {
      continue;
    }
    const review = reviewedByName.get(artifact.name);
    if (review?.kind === "excluded-unrecorded-artifact" && review.reproducedSha256 === artifact.sha256) {
      usedReviews.add(artifact.name);
      results.push({ name: artifact.name, sha256: artifact.sha256, size: artifact.size, status: "excluded", review: review.reviewUrl });
      continue;
    }
    results.push({ name: artifact.name, sha256: artifact.sha256, size: artifact.size, status: "unrecorded" });
    errors.push(`${artifact.name}: built but not recorded in ${expectations.manifestPath}; unrecorded artifacts are never published`);
  }

  for (const entry of reviewed) {
    if (!usedReviews.has(entry.artifact)) {
      errors.push(`${entry.artifact}: reviewed explanation does not apply to this build; remove or correct it`);
    }
  }

  const published = results.filter((result) => result.status === "match" || result.status === "reviewed-mismatch");
  return {
    ok: errors.length === 0,
    errors,
    results: results.sort((left, right) => left.name.localeCompare(right.name)),
    published: published.sort((left, right) => left.name.localeCompare(right.name)),
    verification: errors.length > 0
      ? "failed"
      : published.some((result) => result.status === "reviewed-mismatch")
        ? "matched-with-reviewed-mismatches"
        : "all-recorded-hashes-reproduced",
  };
}

/** Builds the machine-readable checksum document and SHA256SUMS text. */
export function buildChecksums({
  tag,
  tagCommit,
  manifestPath,
  manifestSha256,
  expectations,
  sourceCommitTimestamp,
  cargoLockSha256,
  rustcVersion,
  stellarCliVersion,
  verification,
}) {
  if (!verification.ok) {
    throw new Error("refusing to write checksums for a failed verification");
  }
  const artifacts = verification.published.map((result) => {
    const artifact = {
      name: result.name,
      contract: result.contract,
      sha256: result.sha256,
      size: result.size,
      recordedSha256: result.recordedSha256,
      verification: result.status,
    };
    if (result.review !== undefined) {
      artifact.review = result.review;
    }
    if (result.contract === "test-token") {
      artifact.note = "LBT custom test-only token; not USDC";
    }
    return artifact;
  });
  const document = {
    schemaVersion: 1,
    kind: "lumenbazaar-testnet-wasm-checksums",
    label: "TESTNET release - not a production or mainnet release",
    network: "testnet",
    tag: tag ?? null,
    tagCommit: tagCommit ?? null,
    manifest: { path: manifestPath, sha256: manifestSha256 },
    source: {
      commit: expectations.sourceCommit,
      commitTimestamp: sourceCommitTimestamp,
      cargoLockSha256,
    },
    toolchain: {
      rustc: expectations.rustc,
      rustcVersion,
      stellarCli: expectations.stellarCli,
      stellarCliVersion,
      stellarCliArchiveSha256: stellarCliPin(expectations.stellarCli).sha256,
      target: WASM_TARGET,
    },
    build: {
      command: BUILD_COMMAND.join(" "),
      profile: "release profile from the source commit's Cargo.toml; no additional optimization step",
      timestampSource: "source commit timestamp (no wall-clock time is recorded)",
    },
    verification: {
      result: verification.verification,
      against: manifestPath,
      excluded: verification.results
        .filter((result) => result.status === "excluded")
        .map((result) => ({ name: result.name, sha256: result.sha256, review: result.review })),
    },
    artifacts,
    limitations: [
      "Testnet evidence only. This is not a production or mainnet release.",
      "LBT (test-token) is a custom test-only token and is not USDC.",
      "Checksums prove which reviewed source and toolchain produced the WASM; they are not a security audit.",
    ],
  };
  const sums = artifacts.map((artifact) => `${artifact.sha256}  ${artifact.name}`).join("\n") + "\n";
  return { json: `${JSON.stringify(document, null, 2)}\n`, sums };
}

/**
 * Checks GitHub API responses for the triggering tag: it must be an annotated
 * tag object pointing at `expectedCommit`, with a signature GitHub verified.
 */
export function verifyTagObject({ tagName, expectedCommit, ref, tagObject }) {
  const errors = [];
  if (!RELEASE_TAG_PATTERN.test(tagName ?? "")) {
    errors.push(`tag ${JSON.stringify(tagName)} must match testnet-wasm-YYYY-MM-DD`);
  }
  if (!COMMIT.test(expectedCommit ?? "")) {
    errors.push("expected commit must be a full SHA");
  }
  if (ref?.object?.type !== "tag") {
    errors.push(
      `refs/tags/${tagName} is ${ref?.object?.type === "commit" ? "a lightweight tag" : "not resolvable"}; ` +
        "releases require an annotated, signed tag",
    );
  } else {
    if (tagObject?.tag !== tagName) {
      errors.push("tag object name does not match the triggering ref");
    }
    if (tagObject?.object?.type !== "commit" || tagObject?.object?.sha !== expectedCommit) {
      errors.push("tag does not point directly at the commit this workflow checked out");
    }
    if (tagObject?.verification?.verified !== true) {
      errors.push(
        `tag signature is not verified by GitHub (reason: ${tagObject?.verification?.reason ?? "unknown"}); ` +
          "sign the tag with a key registered on the tagger's GitHub account",
      );
    }
  }
  return errors;
}

export function renderReleaseNotes(checksums) {
  const document = JSON.parse(checksums.json);
  const rows = document.artifacts
    .map((artifact) => `| \`${artifact.name}\` | \`${artifact.sha256}\` | ${artifact.size} | ${artifact.verification}${artifact.note ? ` (${artifact.note})` : ""} |`)
    .join("\n");
  return `# TESTNET WASM checksums ${document.tag ?? "(dry run)"}

**This is a testnet release. It is not a production or mainnet release.** LBT
(\`test-token\`) is a custom test-only token and is not USDC.

These artifacts were rebuilt from source commit \`${document.source.commit}\`
with Rust ${document.toolchain.rustc} and Stellar CLI ${document.toolchain.stellarCli}
using \`${document.build.command}\`, and compared with \`${document.manifest.path}\`.
Verification result: **${document.verification.result}**.

| Artifact | SHA-256 | Bytes | Verification |
| --- | --- | --- | --- |
${rows}

Cargo.lock SHA-256: \`${document.source.cargoLockSha256}\`

Verify independently: see "Verifying a testnet WASM release" in
\`deployments/README.md\`, or run
\`node scripts/reproduce-testnet-wasm.mjs --manifest ${document.manifest.path}\`
on a clean Linux machine with the toolchain above.
`;
}

function sameKeys(object, keys) {
  const actual = Object.keys(object).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
