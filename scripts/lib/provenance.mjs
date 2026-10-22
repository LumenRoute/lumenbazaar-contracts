import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";

export const SBOM_BOM_FORMAT = "CycloneDX";
export const SBOM_SPEC_VERSION = "1.5";
export const PROVENANCE_SCHEMA_VERSION = 1;

export function sha256Hex(input) {
  return createHash("sha256").update(input).digest("hex");
}

// Parses the subset of Cargo.lock that records package identity, registry
// source, checksum, and direct dependencies. It intentionally ignores the
// header keys so a missing or unparsable lockfile fails loudly instead of
// producing a silently empty SBOM.
export function parseCargoLock(text) {
  const normalized = String(text).replace(/\r\n/g, "\n");
  const packages = [];
  let current = null;
  let inDependencies = false;

  for (const rawLine of normalized.split("\n")) {
    const line = rawLine.trim();
    if (line === "[[package]]") {
      current = {
        name: "",
        version: "",
        source: null,
        checksum: null,
        dependencies: [],
      };
      packages.push(current);
      inDependencies = false;
      continue;
    }
    if (current === null) {
      continue;
    }
    let match;
    if ((match = line.match(/^name = "(.*)"$/)) !== null) {
      current.name = match[1];
    } else if ((match = line.match(/^version = "(.*)"$/)) !== null) {
      current.version = match[1];
    } else if ((match = line.match(/^source = "(.*)"$/)) !== null) {
      current.source = match[1];
    } else if ((match = line.match(/^checksum = "(.*)"$/)) !== null) {
      current.checksum = match[1];
    } else if (line === "dependencies = [") {
      inDependencies = true;
    } else if (inDependencies) {
      if (line === "]") {
        inDependencies = false;
      } else if ((match = line.match(/^"(.*?)",?$/)) !== null) {
        current.dependencies.push(match[1]);
      }
    }
  }

  if (packages.length === 0) {
    throw new Error("Cargo.lock did not contain any [[package]] entries.");
  }
  for (const entry of packages) {
    if (entry.name === "" || entry.version === "") {
      throw new Error("Cargo.lock contains a package without a name or version.");
    }
  }
  return packages;
}

export function cargoPurl(name, version) {
  return `pkg:cargo/${name}@${version}`;
}

export function isWorkspacePackage(entry) {
  return entry.source === null;
}

export function buildCycloneDxSbom({ packages, repository, sourceCommit, lockfile, toolchain }) {
  const components = packages
    .map((entry) => {
      const component = {
        type: "library",
        "bom-ref": cargoPurl(entry.name, entry.version),
        name: entry.name,
        version: entry.version,
        purl: cargoPurl(entry.name, entry.version),
        properties: [],
      };
      if (entry.checksum !== null) {
        component.hashes = [{ alg: "SHA-256", content: entry.checksum }];
      }
      if (isWorkspacePackage(entry)) {
        component.properties.push({ name: "lumenbazaar:workspace", value: "true" });
      } else {
        component.properties.push({ name: "lumenbazaar:source", value: entry.source });
      }
      return component;
    })
    .sort((left, right) => (left.purl < right.purl ? -1 : left.purl > right.purl ? 1 : 0));

  return {
    bomFormat: SBOM_BOM_FORMAT,
    specVersion: SBOM_SPEC_VERSION,
    version: 1,
    metadata: {
      component: {
        type: "application",
        name: "lumenbazaar-contracts",
        version: toolchain.contractVersion,
      },
      properties: [
        { name: "lumenbazaar:repository", value: repository },
        { name: "lumenbazaar:sourceCommit", value: sourceCommit },
        { name: "lumenbazaar:lockfilePath", value: lockfile.path },
        { name: "lumenbazaar:lockfileSha256", value: lockfile.sha256 },
        { name: "lumenbazaar:rust", value: toolchain.rust },
        { name: "lumenbazaar:wasmTarget", value: toolchain.wasmTarget },
        { name: "lumenbazaar:sorobanSdk", value: toolchain.sorobanSdk },
        { name: "lumenbazaar:stellarCli", value: toolchain.stellarCli },
        { name: "lumenbazaar:node", value: toolchain.node },
      ],
    },
    components,
  };
}

export function buildProvenance({
  repository,
  sourceCommit,
  lockfile,
  toolchain,
  workspaceCrates,
  artifacts,
}) {
  return {
    schemaVersion: PROVENANCE_SCHEMA_VERSION,
    generator: "scripts/generate-provenance.mjs",
    source: { repository, commit: sourceCommit },
    lockfile,
    toolchain,
    workspaceCrates: [...workspaceCrates].sort(),
    artifacts: [...artifacts].sort((left, right) => (left.name < right.name ? -1 : 1)),
  };
}

export function verifyProvenance({
  provenance,
  sbom,
  packages,
  lockfileSha256,
  toolchain,
  artifacts,
  expectedWasmFiles,
}) {
  const failures = [];

  if (provenance.schemaVersion !== PROVENANCE_SCHEMA_VERSION) {
    failures.push(`unsupported provenance schema version ${provenance.schemaVersion}`);
  }
  if (typeof provenance.source?.commit !== "string" || provenance.source.commit.trim() === "") {
    failures.push("provenance is missing a source commit");
  }
  if (provenance.lockfile?.sha256 !== lockfileSha256) {
    failures.push("lockfile digest does not match the current Cargo.lock");
  }
  for (const key of ["rust", "wasmTarget", "sorobanSdk", "stellarCli", "node"]) {
    if (provenance.toolchain?.[key] !== toolchain[key]) {
      failures.push(`toolchain field ${key} does not match the pinned toolchain`);
    }
  }

  const recordedNames = new Set();
  for (const artifact of provenance.artifacts ?? []) {
    recordedNames.add(artifact.name);
    const observed = artifacts.find((entry) => entry.name === artifact.name);
    if (observed === undefined) {
      failures.push(`provenance references missing artifact ${artifact.name}`);
      continue;
    }
    if (observed.sha256 !== artifact.sha256) {
      failures.push(`artifact ${artifact.name} checksum does not match the built WASM`);
    }
    if (observed.sizeBytes !== artifact.sizeBytes) {
      failures.push(`artifact ${artifact.name} size does not match the built WASM`);
    }
    if (artifact.lockfileSha256 !== lockfileSha256) {
      failures.push(`artifact ${artifact.name} is not bound to the current lockfile`);
    }
    if (artifact.sourceCommit !== provenance.source.commit) {
      failures.push(`artifact ${artifact.name} is not bound to the recorded source commit`);
    }
    if (artifact.toolchain?.rust !== toolchain.rust) {
      failures.push(`artifact ${artifact.name} is not bound to the recorded toolchain`);
    }
  }

  for (const name of expectedWasmFiles) {
    if (!recordedNames.has(name)) {
      failures.push(`built WASM ${name} has no provenance entry`);
    }
  }
  if (recordedNames.size === 0) {
    failures.push("provenance records no released artifacts");
  }

  const components = sbom.components ?? [];
  if (sbom.bomFormat !== SBOM_BOM_FORMAT || sbom.specVersion !== SBOM_SPEC_VERSION) {
    failures.push("SBOM is not a supported CycloneDX document");
  }
  if (components.length !== packages.length) {
    failures.push(
      `SBOM lists ${components.length} components but Cargo.lock has ${packages.length} packages`,
    );
  }
  const componentPurls = new Set(components.map((component) => component.purl));
  for (const entry of packages) {
    if (!componentPurls.has(cargoPurl(entry.name, entry.version))) {
      failures.push(`SBOM is missing transitive crate ${cargoPurl(entry.name, entry.version)}`);
    }
  }
  const workspaceExpectations = packages.filter(isWorkspacePackage);
  for (const entry of workspaceExpectations) {
    const match = components.find((component) => component.purl === cargoPurl(entry.name, entry.version));
    const isWorkspace = match?.properties?.some(
      (property) => property.name === "lumenbazaar:workspace" && property.value === "true",
    );
    if (!isWorkspace) {
      failures.push(`SBOM does not mark workspace crate ${entry.name} as first-party`);
    }
  }

  return failures;
}

export function readLockfile(repoRoot) {
  const path = join(repoRoot, "Cargo.lock");
  const text = readFileSync(path, "utf8").replace(/\r\n/g, "\n");
  return { path: "Cargo.lock", text, sha256: sha256Hex(text), packages: parseCargoLock(text) };
}

export function readToolchain(repoRoot) {
  const toolchainText = readFileSync(join(repoRoot, "rust-toolchain.toml"), "utf8");
  const channel = matchRustValue(toolchainText, "channel") ?? "unknown";
  const targets = parseRustArray(toolchainText, "targets");
  const cargoToml = readFileSync(join(repoRoot, "Cargo.toml"), "utf8");
  const sorobanSdk = matchTomlValue(cargoToml, "soroban-sdk") ?? "unknown";
  const lockText = readFileSync(join(repoRoot, "Cargo.lock"), "utf8");
  const contractVersion = matchLockVersion(lockText, "upto-session") ?? "unknown";
  return {
    rust: channel,
    wasmTarget: targets[0] ?? "unknown",
    sorobanSdk,
    stellarCli: "28.0.0",
    node: process.env.LUMENBAZAAR_PROVENANCE_NODE ?? "22.12.0",
    contractVersion,
  };
}

function matchRustValue(text, key) {
  const match = text.match(new RegExp(`^${key}\\s*=\\s*"(.*)"`, "m"));
  return match?.[1] ?? null;
}

function parseRustArray(text, key) {
  const match = text.match(new RegExp(`^${key}\\s*=\\s*\\[(.*)\\]`, "ms"));
  if (match === null) {
    return [];
  }
  return [...match[1].matchAll(/"([^"]+)"/g)].map((entry) => entry[1]);
}

function matchTomlValue(text, key) {
  const match = text.match(new RegExp(`^${key.replace("-", "\\-")}\\s*=\\s*"(.*)"`, "m"));
  return match?.[1] ?? null;
}

function matchLockVersion(lockText, packageName) {
  const pattern = new RegExp(`\\[\\[package\\]\\]\\s*\\nname = "${packageName}"\\s*\\nversion = "(.*)"`);
  return lockText.replace(/\r\n/g, "\n").match(pattern)?.[1] ?? null;
}

export function artifactNameForWasm(fileName) {
  return basename(fileName).replace(/\.wasm$/, "");
}
