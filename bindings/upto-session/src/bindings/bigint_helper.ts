import { scValToBigInt, nativeToScVal, xdr } from "@stellar/stellar-sdk";

export class BigIntBindingHelper {
  /**
   * Safely converts a large number, string, or BigInt to a Soroban i128 ScVal.
   */
  public static toI128ScVal(value: bigint | string | number): xdr.ScVal {
    const bigVal = BigInt(value);
    // Enforce i128 lower and upper bounds
    const MIN_I128 = -(2n ** 127n);
    const MAX_I128 = 2n ** 127n - 1n;

    if (bigVal < MIN_I128 || bigVal > MAX_I128) {
      raiseRangeError("i128", bigVal);
    }
    return nativeToScVal(bigVal, { type: "i128" });
  }

  /**
   * Safely converts an ScVal back to a native JavaScript BigInt.
   */
  public static fromScValToBigInt(scVal: xdr.ScVal): bigint {
    try {
      return scValToBigInt(scVal);
    } catch (error) {
      throw new Error(`Failed to decode ScVal to BigInt safely: ${(error as Error).message}`);
    }
  }

  /**
   * Performs safe division for token scaling with rounding mode specification.
   */
  public static safeScale(amount: bigint, multiplier: bigint, divisor: bigint): bigint {
    if (divisor === 0n) {
      throw new Error("Division by zero in bigint binding helper.");
    }
    return (amount * multiplier) / divisor;
  }
}

function raiseRangeError(typeName: string, val: bigint): never {
  throw new RangeError(`Value ${val.toString()} exceeds allowable bounds for ${typeName}`);
}
