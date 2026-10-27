// Verifies the Rust-generated encoding compatibility vectors from the backend
// (TypeScript) side and enforces the compatibility lock.
//
//   npm --prefix bindings/upto-session run build
//   node scripts/check-encoding-vectors.mjs [--base <git-ref>]
//
// With --base, every vector version published on the base ref must be
// unchanged in the working tree. See artifacts/backend-handoff/README.md.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  LOCK_FILE,
  compareLocks,
  vectorFileName,
  verifyLock,
  verifyVectors,
} from "./lib/encoding-vectors.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const handoffDir = join(repoRoot, "artifacts", "backend-handoff");
const baseIndex = process.argv.indexOf("--base");
const baseRef = baseIndex === -1 ? "" : (process.argv[baseIndex + 1] ?? "");

const readHandoffFile = (name) => {
  const path = join(handoffDir, name);
  return existsSync(path) ? readFileSync(path) : null;
};

const lockBytes = readHandoffFile(LOCK_FILE);
if (lockBytes === null) {
  fail([`artifacts/backend-handoff/${LOCK_FILE} is missing`]);
}
const lock = JSON.parse(lockBytes.toString("utf8"));
const errors = verifyLock(lock, readHandoffFile);

if (baseRef !== "") {
  if (!/^[0-9A-Za-z._/-]+$/.test(baseRef)) {
    fail([`--base must be a git ref or SHA, received ${JSON.stringify(baseRef)}`]);
  }
  let baseLock = null;
  try {
    baseLock = JSON.parse(
      execFileSync("git", ["show", `${baseRef}:artifacts/backend-handoff/${LOCK_FILE}`], {
        cwd: repoRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }),
    );
  } catch {
    console.log(`No ${LOCK_FILE} on ${baseRef}; treating every locked version as new.`);
  }
  errors.push(...compareLocks(baseLock, lock));
}

const sdk = await import("../bindings/upto-session/dist/index.js");
for (const [key, entry] of Object.entries(lock.versions ?? {})) {
  if (entry?.status === "retired") {
    continue;
  }
  const bytes = readHandoffFile(vectorFileName(Number(key)));
  if (bytes === null) {
    continue;
  }
  for (const error of verifyVectors(JSON.parse(bytes.toString("utf8")), sdk)) {
    errors.push(`${vectorFileName(Number(key))}: ${error}`);
  }
}

if (errors.length > 0) {
  fail(errors);
}
console.log(
  `Encoding vectors verified: current v${lock.current}, ${Object.keys(lock.versions).length} locked version(s).`,
);

function fail(messages) {
  for (const message of messages) {
    console.error(`encoding vectors: ${message}`);
  }
  process.exit(1);
}
