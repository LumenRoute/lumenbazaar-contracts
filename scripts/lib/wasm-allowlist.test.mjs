import assert from "node:assert/strict";
import test from "node:test";
import {
  compareWasmSurface,
  formatWasmDiff,
  inspectWasmBytes,
  validateWasmAllowlist,
} from "./wasm-allowlist.mjs";

// Minimal valid WebAssembly module:
//   (module
//     (import "env" "host_fn" (func))
//     (memory (export "memory") 0)
//     (func (export "ping")))
const SAMPLE_WASM = Uint8Array.from([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
  // Type section: 1 type () -> ()
  0x01, 0x04, 0x01, 0x60, 0x00, 0x00,
  // Import section: "env"."host_fn" func 0
  0x02, 0x0f, 0x01, 0x03, 0x65, 0x6e, 0x76, 0x07, 0x68, 0x6f, 0x73, 0x74, 0x5f, 0x66, 0x6e, 0x00, 0x00,
  // Function section: 1 local func of type 0
  0x03, 0x02, 0x01, 0x00,
  // Memory section: 1 memory min 0
  0x05, 0x03, 0x01, 0x00, 0x00,
  // Export section: "memory" mem 0, "ping" func 1
  0x07, 0x11, 0x02, 0x06, 0x6d, 0x65, 0x6d, 0x6f, 0x72, 0x79, 0x02, 0x00, 0x04, 0x70, 0x69, 0x6e, 0x67, 0x00, 0x01,
  // Code section: empty body
  0x0a, 0x04, 0x01, 0x02, 0x00, 0x0b,
]);

function sampleAllowlist(overrides = {}) {
  return {
    schemaVersion: 1,
    contract: "sample-contract",
    classification: "production",
    artifact: "target/wasm32v1-none/release/sample_contract.wasm",
    imports: [{ module: "env", name: "host_fn", kind: "function" }],
    exports: [
      { name: "memory", kind: "memory" },
      { name: "ping", kind: "function" },
    ],
    ...overrides,
  };
}

test("inspectWasmBytes extracts imports, exports, size, and sha256", () => {
  const observed = inspectWasmBytes(SAMPLE_WASM);
  assert.equal(observed.sizeBytes, SAMPLE_WASM.length);
  assert.match(observed.sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(observed.imports, [{ module: "env", name: "host_fn", kind: "function" }]);
  assert.deepEqual(observed.exports, [
    { name: "memory", kind: "memory" },
    { name: "ping", kind: "function" },
  ]);
});

test("compareWasmSurface passes when imports and exports match allowlist", () => {
  const observed = inspectWasmBytes(SAMPLE_WASM);
  const result = compareWasmSurface(observed, sampleAllowlist());
  assert.equal(result.passed, true);
  assert.deepEqual(result.diffLines, []);
});

test("compareWasmSurface fails with readable diff on unknown import or export", () => {
  const observed = inspectWasmBytes(SAMPLE_WASM);
  const strictAllowlist = sampleAllowlist({
    imports: [],
    exports: [{ name: "memory", kind: "memory" }],
  });

  const result = compareWasmSurface(observed, strictAllowlist);
  assert.equal(result.passed, false);
  assert.equal(result.unexpectedImports.length, 1);
  assert.equal(result.unexpectedExports.length, 1);

  const diff = formatWasmDiff(result);
  assert.match(diff, /\+ import env\.host_fn \(function\)/);
  assert.match(diff, /\+ export ping \(function\)/);
});

test("compareWasmSurface fails when a reviewed export is missing", () => {
  const observed = inspectWasmBytes(SAMPLE_WASM);
  const allowlist = sampleAllowlist({
    exports: [
      { name: "memory", kind: "memory" },
      { name: "ping", kind: "function" },
      { name: "settle", kind: "function" },
    ],
  });

  const result = compareWasmSurface(observed, allowlist);
  assert.equal(result.passed, false);
  assert.equal(result.missingExports.length, 1);
  assert.match(formatWasmDiff(result), /- export settle \(function\)/);
});

test("validateWasmAllowlist rejects invalid classification or duplicate entries", () => {
  assert.throws(
    () => validateWasmAllowlist(sampleAllowlist({ classification: "unknown" })),
    /invalid classification/,
  );
  assert.throws(
    () =>
      validateWasmAllowlist(
        sampleAllowlist({
          imports: [
            { module: "env", name: "host_fn", kind: "function" },
            { module: "env", name: "host_fn", kind: "function" },
          ],
        }),
      ),
    /Duplicate WASM import/,
  );
});
