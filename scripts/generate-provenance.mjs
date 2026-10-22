import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  artifactNameForWasm,
  buildCycloneDxSbom,
  buildProvenance,
  isWorkspacePackage,
  readLockfile,
  readToolchain,
  sha256Hex,
} from "./lib/provenance.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const wasmDir = join(repoRoot, argumentValue("--wasm-dir") ?? join("target", "wasm32v1-none", "release"));
const outDir = join(repoRoot, argumentValue("--out-dir") ?? join("artifacts", "provenance"));

const repository = argumentValue("--repository") ?? process.env.GITHUB_REPOSITORY ?? "LumenRoute/lumenbazaar-contracts";
const sourceCommit = argumentValue("--source-commit") ?? process.env.GITHUB_SHA ?? gitHead();

const lockfile = readLockfile(repoRoot);
const toolchain = readToolchain(repoRoot);
const packages = lockfile.packages;
const workspaceCrates = packages.filter(isWorkspacePackage).map((entry) => entry.name);

const artifacts = readdirSync(wasmDir)
  .filter((fileName) => fileName.endsWith(".wasm"))
  .map((fileName) => {
    const bytes = readFileSync(join(wasmDir, fileName));
    return {
      name: artifactNameForWasm(fileName),
      file: relative(repoRoot, join(wasmDir, fileName)).replaceAll("\\", "/"),
      sha256: sha256Hex(bytes),
      sizeBytes: bytes.length,
      sourceCommit,
      lockfileSha256: lockfile.sha256,
      toolchain: { rust: toolchain.rust, wasmTarget: toolchain.wasmTarget, sorobanSdk: toolchain.sorobanSdk },
    };
  });

if (artifacts.length === 0) {
  throw new Error(`No built WASM artifacts found in ${wasmDir}; build the contracts before generating provenance.`);
}

const provenance = buildProvenance({
  repository,
  sourceCommit,
  lockfile: { path: lockfile.path, sha256: lockfile.sha256 },
  toolchain,
  workspaceCrates,
  artifacts,
});
const sbom = buildCycloneDxSbom({
  packages,
  repository,
  sourceCommit,
  lockfile: { path: lockfile.path, sha256: lockfile.sha256 },
  toolchain,
});

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "build-provenance.json"), `${JSON.stringify(provenance, null, 2)}\n`, "utf8");
writeFileSync(join(outDir, "sbom.cdx.json"), `${JSON.stringify(sbom, null, 2)}\n`, "utf8");

console.log(
  `wrote provenance for ${artifacts.length} WASM artifact(s) and SBOM for ${packages.length} crate(s) to ${relative(repoRoot, outDir)}`,
);

function gitHead() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
  } catch {
    throw new Error("Unable to determine source commit; pass --source-commit or set GITHUB_SHA.");
  }
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}
