export interface AdversarialTokenFixture {
  name: string;
  symbol: string;
  decimals: number;
  initialSupply: bigint;
  behaviorTag: "MAX_SUPPLY_OVERFLOW" | "ZERO_DECIMAL" | "EXTREME_PRECISION" | "MALFORMED_METADATA";
}

export const ADVERSARIAL_TOKEN_FIXTURES: Record<string, AdversarialTokenFixture> = {
  MaxLimitToken: {
    name: "Overflow Risk Token",
    symbol: "OVERFLOW",
    decimals: 7,
    initialSupply: 2n ** 127n - 1n, // Maximum i128 limit
    behaviorTag: "MAX_SUPPLY_OVERFLOW",
  },
  ZeroDecimalToken: {
    name: "Non-Divisible Token",
    symbol: "NODEC",
    decimals: 0,
    initialSupply: 1_000_000n,
    behaviorTag: "ZERO_DECIMAL",
  },
  ExtremePrecisionToken: {
    name: "Max Decimal Token",
    symbol: "MAXDEC",
    decimals: 18,
    initialSupply: 100_000_000n * 10n ** 18n,
    behaviorTag: "EXTREME_PRECISION",
  },
  ZeroSupplyToken: {
    name: "Empty Vault Token",
    symbol: "EMPTY",
    decimals: 6,
    initialSupply: 0n,
    behaviorTag: "MALFORMED_METADATA",
  },
};
