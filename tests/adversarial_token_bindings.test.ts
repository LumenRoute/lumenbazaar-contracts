import * as assert from "assert";
import { BigIntBindingHelper } from "../src/bindings/bigint_helper";
import { ADVERSARIAL_TOKEN_FIXTURES } from "./fixtures/adversarial_tokens";

describe("Adversarial Token Bindings & BigInt Safety", () => {
  it("should correctly serialize and deserialize max i128 initial supply", () => {
    const fixture = ADVERSARIAL_TOKEN_FIXTURES.MaxLimitToken;
    const scVal = BigIntBindingHelper.toI128ScVal(fixture.initialSupply);
    const decodedValue = BigIntBindingHelper.fromScValToBigInt(scVal);

    assert.strictEqual(
      decodedValue,
      fixture.initialSupply,
      "Max i128 supply matches perfectly through XDR round-trip"
    );
  });

  it("should handle zero decimal token scaling without precision loss", () => {
    const fixture = ADVERSARIAL_TOKEN_FIXTURES.ZeroDecimalToken;
    const scaled = BigIntBindingHelper.safeScale(fixture.initialSupply, 2n, 1n);

    assert.strictEqual(scaled, 2_000_000n, "Zero decimal scaling computes correctly");
  });

  it("should throw a RangeError when values exceed i128 boundaries", () => {
    const outOfBoundsValue = 2n ** 128n; // Exceeds signed 128-bit limit

    assert.throws(() => {
      BigIntBindingHelper.toI128ScVal(outOfBoundsValue);
    }, RangeError, "Successfully blocks out-of-bounds integer serialization");
  });

  it("should correctly validate extreme precision 18-decimal token amounts", () => {
    const fixture = ADVERSARIAL_TOKEN_FIXTURES.ExtremePrecisionToken;
    const scVal = BigIntBindingHelper.toI128ScVal(fixture.initialSupply);
    const decoded = BigIntBindingHelper.fromScValToBigInt(scVal);

    assert.strictEqual(decoded, fixture.initialSupply, "High precision token supply is maintained");
  });
});
