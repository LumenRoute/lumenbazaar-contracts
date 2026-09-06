import { readFile } from "node:fs/promises";

const bindings = await import("../bindings/upto-session/dist/index.js");
const distSource = await readFile(
  new URL("../bindings/upto-session/dist/index.js", import.meta.url),
  "utf8",
);

const requiredMethods = [
  "initialize",
  "create_session",
  "get_session",
  "settle",
  "cancel",
  "extend_ttl",
];

if (typeof bindings.Client !== "function") {
  throw new Error("Expected generated Client export");
}

if (bindings.ContractError?.[5]?.message !== "SessionNotFound") {
  throw new Error("Expected stable SessionNotFound error mapping");
}

for (const method of requiredMethods) {
  if (!distSource.includes(method)) {
    throw new Error(`Expected generated binding to include ${method}`);
  }
}

console.log("upto-session TypeScript binding smoke test passed");
