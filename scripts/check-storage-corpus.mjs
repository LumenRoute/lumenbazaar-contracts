// Verifies the committed storage serialization round-trip corpus and lockfile,
// enforces immutability against an optional --base git ref, and optionally
// decodes the corpus under a candidate Rust toolchain.
//
// Usage:
//   node scripts/check-storage-corpus.mjs [--base <git-ref>] [--candidate-toolchain <toolchain>]
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  STORAGE_CORPUS_LOCK_FILE,
  compareStorageCorpusLocks,
  verifyStorageCorpusLock,
} from "./lib/storage-corpus.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const interfaceDir = join(repoRoot, "artifacts", "interface");

const baseRef = flagValue("--base");
const candidateToolchain = flagValue("--candidate-toolchain");

const readInterfaceFile = (relPath) => {
  const fullPath = join(interfaceDir, relPath);
  return existsSync(fullPath) ? readFileSync(fullPath) : null;
};

const lockBytes = readInterfaceFile(STORAGE_CORPUS_LOCK_FILE);
if (lockBytes === null) {
  fail([`artifacts/interface/${STORAGE_CORPUS_LOCK_FILE} is missing`]);
}

const lock = JSON.parse(lockBytes.toString("utf8"));
const errors = verifyStorageCorpusLock(lock, readInterfaceFile);

if (baseRef) {
  if (!/^[0-9A-Za-z._/-]+$/.test(baseRef)) {
    fail([`--base must be a git ref or SHA, received ${JSON.stringify(baseRef)}`]);
  }
  let baseLock = null;
  try {
    baseLock = JSON.parse(
      execFileSync("git", ["show", `${baseRef}:artifacts/interface/${STORAGE_CORPUS_LOCK_FILE}`], {
        cwd: repoRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }),
    );
  } catch {
    console.log(`No ${STORAGE_CORPUS_LOCK_FILE} on ${baseRef}; treating locked versions as new.`);
  }
  errors.push(...compareStorageCorpusLocks(baseLock, lock));
}

if (errors.length > 0) {
  fail(errors);
}

if (candidateToolchain) {
  if (!/^[0-9A-Za-z._-]+$/.test(candidateToolchain)) {
    fail([`--candidate-toolchain has invalid name ${JSON.stringify(candidateToolchain)}`]);
  }
  console.log(`Decoding storage corpus under candidate toolchain +${candidateToolchain}...`);
  execFileSync(
    "cargo",
    [`+${candidateToolchain}`, "test", "-p", "upto-session", "--all-features", "storage_corpus"],
    { cwd: repoRoot, stdio: "inherit" },
  );
}

console.log(
  `Storage serialization corpus verified: layout v${lock.currentLayoutVersion}, ${Object.keys(lock.versions).length} locked version(s).`,
);

function flagValue(flag) {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return "";
  const val = process.argv[idx + 1] ?? "";
  if (!val || val.startsWith("-")) {
    fail([`${flag} requires a value`]);
  }
  return val;
}

function fail(messages) {
  for (const message of messages) {
    console.error(`storage corpus: ${message}`);
  }
  process.exit(1);
}
