import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const skipBuild = process.argv.includes("--skip-build");
const wasm = join(repoRoot, "target", "wasm32v1-none", "release", "upto_session.wasm");
const outputDir = join(repoRoot, "bindings", "upto-session");
const packageLockPath = join(outputDir, "package-lock.json");
const packageLock = existsSync(packageLockPath) ? readFileSync(packageLockPath, "utf8") : null;
// The CLI replaces the output directory, including these handwritten sources.
const preservedSources = [
  "src/bindings/bigint_helper.ts",
  "src/tests/binding_integrity.test.ts",
  "src/tests/bundle_budget.test.ts",
].map((path) => [path, readFileSync(join(outputDir, path))]);

if (!skipBuild) {
  execFileSync("stellar", ["contract", "build", "--locked"], {
    cwd: repoRoot,
    stdio: "inherit",
  });
}

try {
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
} finally {
  for (const [path, content] of preservedSources) {
    const destination = join(outputDir, path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, content);
  }
}

copyFileSync(
  join(repoRoot, "scripts", "templates", "usageReceipt.ts"),
  join(outputDir, "src", "usageReceipt.ts"),
);

const bindingPath = join(outputDir, "src", "index.ts");
const binding = readFileSync(bindingPath, "utf8");
const contractSpecPattern = /new ContractSpec\(\[\s*([\s\S]*?)\s*\]\)/;
const match = binding.match(contractSpecPattern);

if (match === null) {
  throw new Error("Generated binding does not contain a ContractSpec array.");
}

const encodedEntries = [...match[1].matchAll(/"([A-Za-z0-9+/=]+)"/g)].map((entry) => entry[1]);
const remainder = match[1].replaceAll(/"[A-Za-z0-9+/=]+"/g, "").replaceAll(/[\s,]/g, "");

if (encodedEntries.length === 0 || remainder.length > 0) {
  throw new Error("Generated ContractSpec array has an unexpected format.");
}

const canonicalContractSpec = `new ContractSpec([\n${encodedEntries
  .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
  .map((entry) => `        ${JSON.stringify(entry)}`)
  .join(",\n")}\n      ])`;

let canonicalBinding = binding.replace(contractSpecPattern, canonicalContractSpec);
const usageReceiptExport = 'export * from "./usageReceipt.js";';
if (!canonicalBinding.includes(usageReceiptExport)) {
  canonicalBinding = `${canonicalBinding.trimEnd()}\n\n${usageReceiptExport}\n`;
}
writeFileSync(bindingPath, canonicalBinding, "utf8");

const packagePath = join(outputDir, "package.json");
const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
packageJson.version = "3.0.0";
packageJson.dependencies["@stellar/stellar-sdk"] = "17.2.1";
writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");

if (packageLock !== null) {
  writeFileSync(packageLockPath, packageLock, "utf8");
}
