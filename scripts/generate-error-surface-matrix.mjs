import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildErrorSurfaceMatrix,
  collectRustTests,
  parseHandoffDescriptions,
  validateErrorSurfaceMatrix,
} from "./lib/error-surface-matrix.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = join(repoRoot, "contracts", "upto-session", "src");
const handoffPath = join(repoRoot, "docs", "backend-integration-handoff.md");
const outputPath = join(repoRoot, "artifacts", "interface", "upto-session-error-matrix.json");
const check = process.argv.includes("--check");

const libSource = readFileSync(join(srcDir, "lib.rs"), "utf8");
const validationSource = readFileSync(join(srcDir, "validation.rs"), "utf8");
const storageSource = readFileSync(join(srcDir, "storage.rs"), "utf8");
const errorsSource = readFileSync(join(srcDir, "errors.rs"), "utf8");
const handoffMarkdown = readFileSync(handoffPath, "utf8");

const { allTests, testsByError } = collectRustTests(srcDir);
const handoffDescriptions = parseHandoffDescriptions(handoffMarkdown);

const generated = buildErrorSurfaceMatrix({
  libSource,
  validationSource,
  storageSource,
  errorsSource,
  allTests,
  testsByError,
  handoffDescriptions,
});

const issues = validateErrorSurfaceMatrix(generated, generated, allTests);
if (issues.length > 0) {
  for (const issue of issues) {
    console.error(`error-surface-matrix: ${issue}`);
  }
  process.exit(1);
}

const serialized = `${JSON.stringify(generated, null, 2)}\n`;

if (check) {
  const committedText = readFileSync(outputPath, "utf8").replace(/\r\n/g, "\n");
  const committed = JSON.parse(committedText);
  const driftIssues = validateErrorSurfaceMatrix(committed, generated, allTests);
  if (driftIssues.length > 0 || committedText !== serialized) {
    for (const issue of driftIssues) {
      console.error(`error-surface-matrix: ${issue}`);
    }
    if (committedText !== serialized) {
      console.error(
        "error-surface-matrix: artifacts/interface/upto-session-error-matrix.json drifted; run `node scripts/generate-error-surface-matrix.mjs`.",
      );
    }
    process.exit(1);
  }
  console.log(
    `error-surface matrix verified: ${generated.methodCount} methods, ${generated.errorCount} stable errors.`,
  );
} else {
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, serialized, "utf8");
  console.log(
    `wrote ${outputPath} (${generated.methodCount} methods, ${generated.errorCount} stable errors).`,
  );
}
