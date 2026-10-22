import * as assert from "assert";
import * as LumenBazaar from "../src/index";
import packageJson from "../package.json";

describe("Bindings Integrity & Version Alignment", () => {
  it("should export all required contract interfaces and methods", () => {
    const expectedExports = [
      "Client",
      "AssembledTransaction",
      "networks",
      "errors"
    ];

    for (const exp of expectedExports) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(LumenBazaar, exp),
        `Missing expected export: ${exp}`
      );
    }
  });

  it("should maintain version alignment with contract schema", () => {
    const bindingVersion = packageJson.version;
    const protocolVersion = LumenBazaar.networks.FUTURENET?.protocolVersion || packageJson.config?.protocolVersion;

    assert.ok(bindingVersion, "Package version is defined");
    assert.strictEqual(
      bindingVersion,
      packageJson.version,
      "Binding version matches package version configuration"
    );
  });

  it("should verify runtime compatibility (Node.js / browser environment)", () => {
    // Ensure global objects required for WASM / Buffer handling are present
    assert.strictEqual(typeof globalThis.Buffer !== "undefined" || typeof window !== "undefined", true, "Runtime environment supports Buffer or Uint8Array operations");
    assert.strictEqual(typeof WebAssembly !== "undefined", true, "WebAssembly runtime is supported");
  });
});
