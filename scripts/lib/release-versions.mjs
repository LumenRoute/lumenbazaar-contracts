function semver(value) {
  if (!/^\d+\.\d+\.\d+$/.test(value ?? "")) throw new Error(`Invalid stable release version: ${value}`);
  return value.split(".").map(Number);
}
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const bump = (old, kind) => {
  const [major, minor, patch] = semver(old);
  if (kind === "patch") return `${major}.${minor}.${patch + 1}`;
  if (kind === "additive" || major === 0) return `${major}.${minor + 1}.0`;
  return `${major + 1}.0.0`;
};

// Version domains are mapped explicitly. In particular crate 0.3 != binding 3 != schema 2.
export function checkReleaseVersions(plan, actual, { abi, migration, changelog, tag } = {}) {
  const errors = [];
  const { previous, expected, kind } = plan;
  if (plan.schemaVersion !== 1 || !["patch", "additive", "migration"].includes(kind)) throw new Error("Unsupported release plan.");
  for (const key of ["crates", "interfaceVersion", "storageLayoutVersion", "bindingVersion", "deploymentSchemaVersion"]) {
    if (!equal(actual[key], expected[key])) errors.push(`${key}: expected ${JSON.stringify(expected[key])}; found ${JSON.stringify(actual[key])}`);
  }
  if (actual.lockCrates && !equal(actual.lockCrates, actual.crates)) errors.push("Cargo.lock workspace versions differ from contract Cargo.toml versions");
  if (actual.bindingLockVersion !== actual.bindingVersion) errors.push("binding package-lock root version differs from package.json");
  if (actual.bindingLockTopVersion !== undefined && actual.bindingLockTopVersion !== actual.bindingVersion) errors.push("binding package-lock top-level version differs from package.json");
  if (actual.generatorBindingVersion !== actual.bindingVersion) errors.push("binding generator would overwrite the package version");
  const crateVersion = expected.crates["upto-session"];
  if (crateVersion !== plan.releaseVersion || crateVersion !== bump(previous.crates["upto-session"], kind)) {
    errors.push(`upto-session: ${kind} release requires ${bump(previous.crates["upto-session"], kind)}, found ${crateVersion}`);
  }
  for (const [name, version] of Object.entries(expected.crates)) {
    semver(version);
    if (name !== "upto-session" && version !== previous.crates[name]
      && version !== bump(previous.crates[name], "patch") && version !== bump(previous.crates[name], "additive")
      && version !== bump(previous.crates[name], "migration")) errors.push(`${name}: unsupported version transition`);
  }
  const [oldMajor, oldMinor, oldPatch] = semver(previous.bindingVersion);
  const binding = kind === "patch" ? `${oldMajor}.${oldMinor}.${oldPatch + 1}`
    : kind === "additive" ? `${oldMajor}.${oldMinor + 1}.0` : `${oldMajor + 1}.0.0`;
  if (expected.bindingVersion !== binding) errors.push(`bindingVersion: ${kind} release requires ${binding}`);
  if (kind === "migration") {
    if (expected.interfaceVersion !== previous.interfaceVersion + 1) errors.push("migration requires the next interface version");
    if (!migration || migration.fromInterfaceVersion !== previous.interfaceVersion
      || migration.toInterfaceVersion !== expected.interfaceVersion || migration.baselineReleaseTag !== plan.baselineTag
      || !migration.compatibilityNotes?.length) errors.push("migration evidence is missing or does not match the release plan");
    if (![previous.storageLayoutVersion, previous.storageLayoutVersion + 1].includes(expected.storageLayoutVersion)) errors.push("storage layout must remain stable or advance once during migration");
  } else {
    for (const field of ["interfaceVersion", "storageLayoutVersion"]) {
      if (expected[field] !== previous[field]) errors.push(`${field}: premature change in a compatible release`);
    }
    if (abi?.breaking?.length) errors.push("breaking ABI changes require a migration release");
    if (kind === "patch" && abi?.additive?.length) errors.push("additive ABI changes require an additive release");
  }
  if (![previous.deploymentSchemaVersion, previous.deploymentSchemaVersion + 1].includes(expected.deploymentSchemaVersion)) {
    errors.push("deployment schema must remain stable or advance once independently of interface versions");
  }
  if (!/^## (?:Unreleased|\[Unreleased\])/m.test(changelog ?? "") && !String(changelog).includes(`## v${plan.releaseVersion}`)) {
    errors.push("changelog has no Unreleased or target release section");
  }
  if (tag) {
    if (!new RegExp(`^v${plan.releaseVersion.replaceAll(".", "\\.")}(?:-[A-Za-z0-9.-]+)?$`).test(tag)) errors.push(`tag ${tag} does not match release ${plan.releaseVersion}`);
    if (!String(changelog).split(/\r?\n/).some((line) => line === `## ${tag}` || line === `## [${tag}]`)) errors.push(`changelog must contain a finalized ${tag} section before tagging`);
  }
  return errors;
}
