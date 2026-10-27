// Release and manifest guard: the LBT `test-token` contract may only appear
// under explicitly allowlisted local or testnet labels. Anything else,
// including a missing or unknown label, is treated as production and rejected.
// It also rejects text that presents LBT as USDC or as a production asset.

export const TEST_PASSPHRASE = "Test SDF Network ; September 2015";
export const STANDALONE_PASSPHRASE = "Standalone Network ; February 2017";
export const PUBLIC_PASSPHRASE = "Public Global Stellar Network ; September 2015";

/** Normalized labels that are known to be non-production in this repository. */
export const NON_PRODUCTION_LABELS = new Set(
  ["local", "standalone", "testnet", "test sdf network", TEST_PASSPHRASE, STANDALONE_PASSPHRASE].map(
    normalizeLabel,
  ),
);

const PRODUCTION_KEYWORDS = ["pubnet", "public", "mainnet", "production", "prod"];

// Keys whose string values describe the target network or release channel.
const LABEL_KEYS = new Set(
  [
    "environment",
    "env",
    "network",
    "networkName",
    "networkPassphrase",
    "passphrase",
    "label",
    "releaseLabel",
    "stage",
    "tier",
  ].map((key) => key.toLowerCase()),
);
// Inside a `network` object, `name` is a label too.
const NETWORK_OBJECT_LABEL_KEYS = new Set(["name", "passphrase", "networkpassphrase"]);

const TEST_TOKEN_KEYS = new Set(["test-token", "test_token", "testtoken"]);
const TEST_TOKEN_TEXT = /\btest[-_]token\b|\btest_token\.wasm\b|\bLBT\b/i;
const CLAIM_TEXT = /\bUSDC\b|production asset|mainnet asset|stablecoin/i;
const NEGATION_TEXT = /\b(not|never|no|isn't|cannot|rather than|instead of)\b/i;

export const LBT_NOT_USDC = "LBT is a test-only token and is NOT USDC";

export function normalizeLabel(value) {
  return String(value).normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
}

/** Classifies one label: `non-production`, `production` or `unknown`. */
export function classifyLabel(value) {
  const label = normalizeLabel(value);
  if (NON_PRODUCTION_LABELS.has(label)) {
    return "non-production";
  }
  if (label === normalizeLabel(PUBLIC_PASSPHRASE)) {
    return "production";
  }
  const words = label.split(/[^a-z0-9]+/).filter(Boolean);
  if (PRODUCTION_KEYWORDS.some((keyword) => words.includes(keyword))) {
    return "production";
  }
  return "unknown";
}

/** Collects `{ path, value }` for every network/environment label in `value`. */
export function collectLabels(value, path = "$", inNetworkObject = false, labels = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectLabels(item, `${path}[${index}]`, false, labels));
    return labels;
  }
  if (!isRecord(value)) {
    return labels;
  }
  for (const [key, child] of Object.entries(value)) {
    const lower = key.toLowerCase();
    const childPath = `${path}.${key}`;
    const isLabelKey = LABEL_KEYS.has(lower) || (inNetworkObject && NETWORK_OBJECT_LABEL_KEYS.has(lower));
    if (isLabelKey && typeof child === "string") {
      labels.push({ path: childPath, value: child });
    } else {
      collectLabels(child, childPath, lower === "network", labels);
    }
  }
  return labels;
}

/** Returns the JSON paths that reference the test token (keys, artifact names, LBT). */
export function findTestTokenReferences(value, path = "$", found = []) {
  if (typeof value === "string") {
    if (TEST_TOKEN_TEXT.test(value)) {
      found.push(path);
    }
    return found;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => findTestTokenReferences(item, `${path}[${index}]`, found));
    return found;
  }
  if (!isRecord(value)) {
    return found;
  }
  for (const [key, child] of Object.entries(value)) {
    if (TEST_TOKEN_KEYS.has(key.toLowerCase())) {
      found.push(`${path}.${key}`);
    }
    findTestTokenReferences(child, `${path}.${key}`, found);
  }
  return found;
}

/** True when `text` mentions LBT/test-token together with a USDC or production-asset claim that is not negated. */
export function isAffirmativeClaim(text) {
  return TEST_TOKEN_TEXT.test(text) && CLAIM_TEXT.test(text) && !NEGATION_TEXT.test(text);
}

/**
 * Checks one parsed manifest or release description. Returns violation
 * messages; an empty array means it passes.
 */
export function checkManifest(manifest, source) {
  const violations = [];
  const references = findTestTokenReferences(manifest);
  if (references.length > 0) {
    const labels = collectLabels(manifest);
    if (labels.length === 0) {
      violations.push(
        `${source}: test-token (LBT) is referenced at ${references[0]} but no network or environment ` +
          `label is present, so it is treated as production. ${LBT_NOT_USDC}. Add an explicit ` +
          "local, standalone or testnet label, or remove test-token from this manifest.",
      );
    }
    for (const label of labels) {
      const kind = classifyLabel(label.value);
      if (kind === "non-production") {
        continue;
      }
      violations.push(
        `${source}: test-token (LBT) is referenced at ${references[0]} under ${kind === "production" ? "production" : "unrecognized (treated as production)"} ` +
          `label ${JSON.stringify(label.value)} at ${label.path}. ${LBT_NOT_USDC} and must never be ` +
          "packaged or deployed for pubnet or production. Remove test-token from this production " +
          "manifest, or correct the label if this is genuinely a local or testnet deployment.",
      );
    }
  }
  for (const claim of findClaims(manifest)) {
    violations.push(
      `${source}: ${claim.path} presents LBT as USDC or a production asset (${JSON.stringify(claim.text)}). ` +
        `${LBT_NOT_USDC}; describe it as a custom test-only token.`,
    );
  }
  return violations;
}

/** Checks a release: its label and the artifact file names it would package. */
export function checkRelease({ label, artifacts }, source = "release") {
  if (!Array.isArray(artifacts)) {
    return [`${source}: release artifact list must be an array`];
  }
  const release = { artifacts };
  if (typeof label === "string" && label.trim() !== "") {
    release.releaseLabel = label;
  }
  return checkManifest(release, source);
}

/**
 * Checks Markdown/text for affirmative LBT-is-USDC claims. Wrapped lines are
 * joined into paragraphs (split at blank lines, headings and list items) and
 * judged sentence by sentence, so a negation on the next physical line counts.
 */
export function checkDocument(text, source) {
  const violations = [];
  for (const { line, text: sentence } of sentences(text)) {
    if (isAffirmativeClaim(sentence)) {
      violations.push(
        `${source}:${line}: presents LBT as USDC or a production asset. ${LBT_NOT_USDC}; ` +
          "describe it as a custom test-only token.",
      );
    }
  }
  return violations;
}

function sentences(text) {
  const blocks = [];
  let current = null;
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    const startsBlock = /^(#{1,6}\s|[-*+]\s|\d+\.\s|\|)/.test(line);
    if (line === "" || startsBlock) {
      current = null;
    }
    if (line === "") {
      return;
    }
    if (current === null) {
      current = { line: index + 1, parts: [] };
      blocks.push(current);
    }
    current.parts.push(line);
  });
  return blocks.flatMap(({ line, parts }) =>
    parts
      .join(" ")
      .split(/(?<=[.!?])\s+/)
      .map((sentence) => ({ line, text: sentence })),
  );
}

function findClaims(value, path = "$", claims = []) {
  if (typeof value === "string") {
    if (isAffirmativeClaim(value)) {
      claims.push({ path, text: value });
    }
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => findClaims(item, `${path}[${index}]`, claims));
  } else if (isRecord(value)) {
    for (const [key, child] of Object.entries(value)) {
      findClaims(child, `${path}.${key}`, claims);
    }
  }
  return claims;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
