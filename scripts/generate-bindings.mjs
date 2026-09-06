import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const skipBuild = process.argv.includes("--skip-build");
const wasm = join(repoRoot, "target", "wasm32v1-none", "release", "upto_session.wasm");
const outputDir = join(repoRoot, "bindings", "upto-session");

if (!skipBuild) {
  execFileSync("stellar", ["contract", "build", "--locked"], {
    cwd: repoRoot,
    stdio: "inherit",
  });
}

execFileSync(
  "stellar",
  [
    "contract",
    "bindings",
    "typescript",
    "--wasm",
    wasm,
    "--output-dir",
    outputDir,
    "--overwrite",
  ],
  {
    cwd: repoRoot,
    stdio: "inherit",
  },
);
