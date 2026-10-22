import { homedir } from "node:os";

// Only values of secret-bearing variables are collected; environment contents are never logged.
export function configuredSecrets(env = process.env) {
  return Object.entries(env)
    .filter(([name]) => /(?:SECRET|PRIVATE[_-]?KEY|MNEMONIC|SEED|PASSWORD|TOKEN)/i.test(name)
      || ["STELLAR_ACCOUNT", "LUMENBAZAAR_SOURCE_ACCOUNT"].includes(name))
    .map(([, value]) => value)
    .filter((value) => !/^G[A-Z2-7]{55}$/.test(value ?? ""));
}

export function redactText(text, values = []) {
  let output = String(text ?? "");
  const variants = new Set();
  for (const value of [homedir(), ...configuredSecrets(), ...values]) {
    if (typeof value !== "string" || value.length < 3) continue;
    for (const variant of [value, JSON.stringify(value).slice(1, -1), encodeURIComponent(value),
      Buffer.from(value).toString("base64"), Buffer.from(value).toString("base64url")]) {
      variants.add(variant);
    }
  }
  for (const value of [...variants].sort((a, b) => b.length - a.length)) {
    output = output.split(value).join("<redacted>");
  }
  return output
    .replace(/-----BEGIN (?:[A-Z ]*PRIVATE KEY)-----[\s\S]*?-----END (?:[A-Z ]*PRIVATE KEY)-----/g, "<redacted>")
    .replace(/\bS[A-Z2-7]{55}\b/g, "<redacted>")
    .replace(/\b(?:[a-z]+[ \t\r\n]+){11,23}[a-z]+\b/g, "<redacted>")
    .replace(/((?:private[_ -]?key|secret|seed|mnemonic|password)\s*[:=]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s,;]+)/gi, "$1<redacted>");
}

export function signerValues(args) {
  const flags = new Set(["--source-account", "--sign-with-key", "--secret-key", "--seed", "--mnemonic"]);
  const positional = args[0] === "keys" && args[1] === "public-key" ? [args[2]] : [];
  return [...positional, ...args.flatMap((arg, index) => {
    if (flags.has(arg)) return [args[index + 1]];
    const separator = arg.indexOf("=");
    return separator > 0 && flags.has(arg.slice(0, separator)) ? [arg.slice(separator + 1)] : [];
  })].filter((value) => !/^G[A-Z2-7]{55}$/.test(value ?? ""));
}

export function logDeployment(event, fields, { redact = [], sink = console.log } = {}) {
  // Sanitize before JSON serialization so embedded newlines and repeated values are covered.
  const clean = (value) => {
    if (typeof value === "string") return redactText(value, redact);
    if (Array.isArray(value)) return value.map(clean);
    if (value && typeof value === "object") return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [redactText(key, redact), clean(child)]),
    );
    return value;
  };
  sink(JSON.stringify(clean({ event, ...fields })));
}
