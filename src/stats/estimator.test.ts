import { describe, it, expect } from "vitest";
import { estimateTokens, estimateSearchEnvelopeTokens } from "./estimator.js";

describe("estimateTokens", () => {
  it("divides string length by 4 and ceilings", () => {
    expect(estimateTokens("123")).toBe(1);
    expect(estimateTokens("1234")).toBe(1);
    expect(estimateTokens("12345")).toBe(2);
  });
});

describe("estimateSearchEnvelopeTokens", () => {
  it("computes tokens for content and json envelope", () => {
    const matches = [
      { file: "a.ts", content: "hello world" },
      { file: "b.ts", estimatedTokens: 10 },
    ];
    
    const tokens = estimateSearchEnvelopeTokens(matches);
    
    expect(tokens).toBeGreaterThan(13);
    expect(tokens).toBeLessThan(50);
  });
});
