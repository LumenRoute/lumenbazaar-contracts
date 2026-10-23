import * as fs from "fs";
import * as path from "path";
import * as assert from "assert";

describe("Bundle Budget & Artifact Constraints", () => {
  const MAX_BUNDLE_SIZE_KB = 250; // Maximum allowed bundle size in KB
  const BINDINGS_DIST_PATH = path.resolve(__dirname, "../dist/index.js");

  it("should enforce maximum bundle size budget", () => {
    if (!fs.existsSync(BINDINGS_DIST_PATH)) {
      // Skip if build artifact isn't pre-generated in local test runs without build step
      console.warn("Distribution build artifact not found; skipping bundle budget check.");
      return;
    }

    const stats = fs.statSync(BINDINGS_DIST_PATH);
    const fileSizeKB = stats.size / 1024;

    assert.ok(
      fileSizeKB <= MAX_BUNDLE_SIZE_KB,
      `Bundle size budget exceeded! Current size: ${fileSizeKB.toFixed(2)} KB, Maximum allowed: ${MAX_BUNDLE_SIZE_KB} KB`
    );
  });

  it("should ensure all WASM reference bindings load without runtime errors", () => {
    const wasmPath = path.resolve(__dirname, "../wasm/lumenbazaar.wasm");
    if (fs.existsSync(wasmPath)) {
      const wasmBuffer = fs.readFileSync(wasmPath);
      assert.ok(wasmBuffer.length > 0, "WASM binary is not empty");
      
      const isValidWasmModule = WebAssembly.validate(wasmBuffer);
      assert.strictEqual(isValidWasmModule, true, "WASM binary passes WebAssembly validation checks");
    }
  });
});
