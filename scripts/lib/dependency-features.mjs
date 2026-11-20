const REQUIRED_EXCEPTION_FIELDS = [
  "package",
  "feature",
  "scope",
  "owner",
  "reason",
  "expiresOn",
];

const VALID_SCOPES = new Set(["release", "test"]);

export function parseCargoTreeDepth(output) {
  const packages = new Map();
  const stack = [];

  for (const rawLine of String(output).replace(/\r\n/g, "\n").split("\n")) {
    const trimmed = rawLine.trim();
    if (trimmed === "") {
      continue;
    }
    const depthMatch = trimmed.match(/^(\d+)(.+)$/);
    if (!depthMatch) {
      continue;
    }

    const depth = Number(depthMatch[1]);
    let rest = depthMatch[2].trim();
    if (rest.endsWith("(*)")) {
      rest = rest.slice(0, -3).trim();
    }

    const featureMatch = rest.match(/\[([^\]]*)\]$/);
    if (!featureMatch) {
      throw new Error(`Unable to parse cargo tree line (missing feature list): ${rawLine}`);
    }

    const features = featureMatch[1]
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .sort();

    const spec = rest.slice(0, featureMatch.index).trim();
    const tokens = spec.split(/\s+/);
    if (tokens.length < 2) {
      throw new Error(`Unable to parse cargo tree package spec: ${rawLine}`);
    }
    const name = tokens[0];
    const version = tokens[1].replace(/^v/, "");
    const nodeLabel = `${name} ${version}`;

    stack.length = depth;
    stack[depth] = nodeLabel;
    const dependencyPath = stack.join(" -> ");

    let entry = packages.get(name);
    if (!entry) {
      entry = {
        name,
        versions: new Set(),
        features: new Map(),
      };
      packages.set(name, entry);
    }
    entry.versions.add(version);

    for (const feature of features) {
      let paths = entry.features.get(feature);
      if (!paths) {
        paths = new Set();
        entry.features.set(feature, paths);
      }
      paths.add(dependencyPath);
    }
  }

  return normalizeFeatureGraph(packages);
}

export function mergeFeatureGraphs(graphs) {
  const merged = new Map();

  for (const graph of graphs) {
    for (const pkg of graph.packages ?? []) {
      let entry = merged.get(pkg.name);
      if (!entry) {
        entry = {
          name: pkg.name,
          versions: new Set(),
          features: new Map(),
        };
        merged.set(pkg.name, entry);
      }
      for (const version of pkg.versions ?? []) {
        entry.versions.add(version);
      }
      for (const [feature, paths] of Object.entries(pkg.featurePaths ?? {})) {
        let pathSet = entry.features.get(feature);
        if (!pathSet) {
          pathSet = new Set();
          entry.features.set(feature, pathSet);
        }
        for (const depPath of paths) {
          pathSet.add(depPath);
        }
      }
    }
  }

  return normalizeFeatureGraph(merged);
}

function normalizeFeatureGraph(packagesMap) {
  const packages = [...packagesMap.values()]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => {
      const features = [...entry.features.keys()].sort();
      const featurePaths = {};
      for (const feature of features) {
        featurePaths[feature] = [...entry.features.get(feature)].sort();
      }
      return {
        name: entry.name,
        versions: [...entry.versions].sort(),
        features,
        featurePaths,
      };
    });

  const featureCount = packages.reduce((sum, pkg) => sum + pkg.features.length, 0);
  return {
    packageCount: packages.length,
    featureCount,
    packages,
  };
}

export function validateFeatureAllowlist(allowlist, nowDate = new Date()) {
  if (!allowlist || typeof allowlist !== "object" || allowlist.schemaVersion !== 1) {
    throw new Error("Dependency feature allowlist must use schemaVersion 1.");
  }
  if (typeof allowlist.releaseTarget !== "string" || allowlist.releaseTarget.trim() === "") {
    throw new Error("Dependency feature allowlist must specify releaseTarget.");
  }
  if (!Array.isArray(allowlist.releasePackages) || allowlist.releasePackages.length === 0) {
    throw new Error("Dependency feature allowlist must specify non-empty releasePackages.");
  }
  if (!Array.isArray(allowlist.testPackages) || allowlist.testPackages.length === 0) {
    throw new Error("Dependency feature allowlist must specify non-empty testPackages.");
  }
  if (
    !allowlist.releaseAllowlist ||
    typeof allowlist.releaseAllowlist !== "object" ||
    Array.isArray(allowlist.releaseAllowlist)
  ) {
    throw new Error("Dependency feature allowlist must contain a releaseAllowlist object.");
  }
  for (const [pkg, features] of Object.entries(allowlist.releaseAllowlist)) {
    if (!Array.isArray(features) || features.some((item) => typeof item !== "string" || item.trim() === "")) {
      throw new Error(`Invalid releaseAllowlist entry for package ${pkg}.`);
    }
  }
  if (!Array.isArray(allowlist.exceptions)) {
    throw new Error("Dependency feature allowlist must contain an exceptions array.");
  }

  const today = new Date(nowDate);
  today.setUTCHours(0, 0, 0, 0);
  const seen = new Set();

  for (const exception of allowlist.exceptions) {
    for (const field of REQUIRED_EXCEPTION_FIELDS) {
      if (typeof exception?.[field] !== "string" || exception[field].trim() === "") {
        throw new Error(`Dependency feature exception is missing required field: ${field}.`);
      }
    }
    if (!VALID_SCOPES.has(exception.scope)) {
      throw new Error(
        `Invalid scope "${exception.scope}" for exception ${exception.package}/${exception.feature}; expected "release" or "test".`,
      );
    }
    const key = `${exception.scope}:${exception.package}:${exception.feature}`;
    if (seen.has(key)) {
      throw new Error(`Duplicate dependency feature exception: ${key}.`);
    }
    seen.add(key);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(exception.expiresOn)) {
      throw new Error(
        `Invalid expiresOn date "${exception.expiresOn}" for ${exception.package}/${exception.feature}; expected YYYY-MM-DD.`,
      );
    }
    const expiry = new Date(`${exception.expiresOn}T00:00:00Z`);
    if (Number.isNaN(expiry.getTime())) {
      throw new Error(
        `Invalid expiresOn date "${exception.expiresOn}" for ${exception.package}/${exception.feature}.`,
      );
    }
    if (expiry < today) {
      throw new Error(
        `Dependency feature exception ${exception.package}/${exception.feature} (${exception.scope}) expired on ${exception.expiresOn}.`,
      );
    }
  }
}

export function evaluateFeatureGraphs({ releaseGraph, testGraph, allowlist, nowDate = new Date() }) {
  validateFeatureAllowlist(allowlist, nowDate);

  const releaseExceptions = new Map();
  for (const exception of allowlist.exceptions) {
    if (exception.scope === "release") {
      releaseExceptions.set(`${exception.package}:${exception.feature}`, exception);
    }
  }

  const violations = [];
  const appliedExceptions = [];

  for (const pkg of releaseGraph.packages) {
    const allowed = new Set(allowlist.releaseAllowlist[pkg.name] ?? []);
    for (const feature of pkg.features) {
      if (allowed.has(feature)) {
        continue;
      }
      const exception = releaseExceptions.get(`${pkg.name}:${feature}`);
      const paths = pkg.featurePaths[feature] ?? [];
      if (exception) {
        appliedExceptions.push({
          package: pkg.name,
          feature,
          owner: exception.owner,
          reason: exception.reason,
          expiresOn: exception.expiresOn,
          paths,
        });
        continue;
      }
      violations.push({
        package: pkg.name,
        versions: pkg.versions,
        feature,
        paths,
      });
    }
  }

  const releaseFeaturesByPackage = {};
  for (const pkg of releaseGraph.packages) {
    if (pkg.features.length > 0) {
      releaseFeaturesByPackage[pkg.name] = pkg.features;
    }
  }

  const testOnlyFeatures = {};
  for (const pkg of testGraph.packages) {
    const releaseSet = new Set(releaseFeaturesByPackage[pkg.name] ?? []);
    const extras = pkg.features.filter((feature) => !releaseSet.has(feature));
    if (extras.length > 0) {
      testOnlyFeatures[pkg.name] = extras;
    }
  }

  return {
    passed: violations.length === 0,
    violations,
    appliedExceptions,
    releaseSummary: {
      packageCount: releaseGraph.packageCount,
      featureCount: releaseGraph.featureCount,
      enabledFeatures: releaseFeaturesByPackage,
    },
    testSummary: {
      packageCount: testGraph.packageCount,
      featureCount: testGraph.featureCount,
      testOnlyFeatures,
    },
  };
}

export function formatViolations(violations) {
  return violations
    .map((item) => {
      const versionText = item.versions.length > 0 ? ` (${item.versions.join(", ")})` : "";
      const pathLines =
        item.paths.length > 0
          ? item.paths.map((depPath) => `    path: ${depPath}`).join("\n")
          : "    path: <unavailable>";
      return `- ${item.package}${versionText} enabled unreviewed release feature "${item.feature}"\n${pathLines}`;
    })
    .join("\n");
}
