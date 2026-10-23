import { posix } from "node:path";

// Remove cfg(test) items, matching braces while ignoring strings and comments.
export function productionRust(source) {
  const mask = source.replace(/\/\*[\s\S]*?\*\//g, (s) => " ".repeat(s.length))
    .replace(/\/\/[^\n]*/g, (s) => " ".repeat(s.length))
    .replace(/"(?:\\.|[^"\\])*"/g, (s) => " ".repeat(s.length));
  const ranges = [];
  const pattern = /#\[cfg\(test\)\]/g;
  let match;
  while ((match = pattern.exec(mask))) {
    let start = match.index + match[0].length;
    // A test-only module declaration may end in a semicolon rather than a body.
    const open = mask.indexOf("{", start);
    const semi = mask.indexOf(";", start);
    if (semi >= 0 && (open < 0 || semi < open)) { ranges.push([match.index, semi + 1]); continue; }
    if (open < 0) continue;
    let depth = 1;
    let end = open + 1;
    for (; end < mask.length && depth; end++) {
      if (mask[end] === "{") depth++;
      if (mask[end] === "}") depth--;
    }
    if (depth === 0) ranges.push([match.index, end]);
  }
  let output = source;
  for (const [start, end] of ranges.reverse()) output = output.slice(0, start) + output.slice(end);
  return output.replace(/\r\n/g, "\n").trim();
}

export function contractFacingChanges(changes) {
  return changes.filter(({ path, before = "", after = "" }) => {
    if (/(?:^|\/)(?:tests?|fixtures|benches)(?:\/|\.)|\.test\.[cm]?[jt]s$/.test(path)) return false;
    if (/^contracts\/[^/]+\/src\/.*\.rs$/.test(path)) return productionRust(before) !== productionRust(after);
    return /^(?:artifacts\/(?:interface|spec)\/|bindings\/|deployments\/|scripts\/(?:local|testnet|lib)\/)/.test(path)
      || /^scripts\/(?:generate-(?:bindings|specs|interface-fixtures)|verify-).*\.mjs$/.test(path)
      || /^contracts\/[^/]+\/Cargo.toml$/.test(path);
  }).map(({ path }) => path);
}

export function changelogEntries(source) {
  const unreleased = source.match(/^## (?:\[)?Unreleased(?:\])?[^\n]*\n([\s\S]*?)(?=^## |$(?![\s\S]))/m)?.[1] ?? "";
  let category = "";
  const entries = [];
  for (const line of unreleased.split(/\r?\n/)) {
    const heading = line.match(/^###\s+(.+?)\s*$/);
    if (heading) { category = heading[1]; continue; }
    const bullet = line.match(/^-\s+(.+)/);
    if (bullet) entries.push({ category, text: bullet[1] });
    else if (/^\s+\S/.test(line) && entries.length) entries.at(-1).text += ` ${line.trim()}`;
  }
  return entries;
}

export function checkChangelog({ changes, beforeChangelog, changelog, breaking = false, exists = () => false }) {
  const paths = contractFacingChanges(changes);
  if (!paths.length) return { paths, errors: [] };
  const previous = new Set(changelogEntries(beforeChangelog).map(({ text }) => text));
  const entries = changelogEntries(changelog).filter(({ text }) => !previous.has(text));
  const errors = [];
  if (!entries.length) errors.push("Contract-facing changes need a new categorized Unreleased changelog entry.");
  let breakingEvidence = false;
  for (const entry of entries) {
    if (!["Added", "Changed", "Fixed", "Security", "Breaking"].includes(entry.category)) errors.push("New entries must be categorized Added, Changed, Fixed, Security or Breaking.");
    if (!/\bCompatibility:\s*\S/i.test(entry.text)) errors.push("New entries must describe Compatibility: impact.");
    if (!/\bMigration:\s*\S/i.test(entry.text)) errors.push("New entries must describe Migration: impact.");
    if (entry.category === "Breaking" || /Compatibility:\s*breaking\b/i.test(entry.text)) {
      const reference = entry.text.match(/Migration:\s*(?:\[[^\]]+\]\(([^)]+)\)|`([^`]+)`)/i);
      const path = reference?.[1] ?? reference?.[2];
      const valid = path && !path.includes("\\") && !posix.isAbsolute(path) && !path.split("/").includes("..")
        && /^(?:docs\/|artifacts\/interface\/migrations\/)/.test(path) && exists(path);
      if (!valid) errors.push("Breaking entries require Migration: [description](existing-repository-path) evidence.");
      else breakingEvidence = true;
    }
  }
  if (breaking && !breakingEvidence) errors.push("Detected breaking ABI changes require a Breaking entry with a migration reference.");
  return { paths, errors };
}
