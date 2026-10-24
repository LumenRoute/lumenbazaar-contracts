import { readFileSync } from "node:fs";

/**
 * Reads the `CONTRACT_ERROR_CODES` object from the TypeScript error template
 * as `[{ name, value }]`, in source order.
 */
export function readTemplateErrors(templatePath) {
  const source = readFileSync(templatePath, "utf8").replace(/\r\n/g, "\n");
  const block = source.match(/export const CONTRACT_ERROR_CODES = \{\n([\s\S]*?)\n\} as const;/);
  if (block === null) {
    throw new Error("contractErrors.ts template does not declare CONTRACT_ERROR_CODES");
  }
  return block[1].split("\n").map((line) => {
    const entry = line.match(/^ {2}([A-Za-z][A-Za-z0-9]*): (\d+),$/);
    if (entry === null) {
      throw new Error(`Unexpected CONTRACT_ERROR_CODES line: ${line.trim()}`);
    }
    return { name: entry[1], value: Number(entry[2]) };
  });
}

/**
 * Returns the differences between the binding's error map and the frozen
 * interface fixture's errors; an empty array means they agree exactly.
 */
export function diffErrorMaps(templateErrors, fixtureErrors) {
  const problems = [];
  const fixtureByName = new Map(fixtureErrors.map((entry) => [entry.name, entry.value]));
  const templateByName = new Map(templateErrors.map((entry) => [entry.name, entry.value]));
  for (const { name, value } of fixtureErrors) {
    if (!templateByName.has(name)) {
      problems.push(`missing ${name}=${value}`);
    } else if (templateByName.get(name) !== value) {
      problems.push(`${name} is ${templateByName.get(name)} in the binding but ${value} in the fixture`);
    }
  }
  for (const { name, value } of templateErrors) {
    if (!fixtureByName.has(name)) {
      problems.push(`unexpected ${name}=${value}`);
    }
  }
  const values = templateErrors.map((entry) => entry.value);
  if (new Set(values).size !== values.length) {
    problems.push("duplicate error codes");
  }
  return problems;
}

/** Throws when the template and fixture disagree. */
export function assertErrorMapMatchesFixture(templatePath, fixturePath) {
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
  const problems = diffErrorMaps(readTemplateErrors(templatePath), fixture.errors);
  if (problems.length > 0) {
    throw new Error(
      `TypeScript contract error map drifted from ${fixturePath}:\n  ${problems.join("\n  ")}`,
    );
  }
}
