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
    
    // content tokens = ceil(11/4) + 10 = 3 + 10 = 13
    const tokens = estimateSearchEnvelopeTokens(matches);
    
    // Envelope: {"status":"success","matches":[{"file":"a.ts","content":""},{"file":"b.ts"}]}
    // Length is roughly 80 chars -> 20 tokens
    // Total should be ~33
    expect(tokens).toBeGreaterThan(13);
    expect(tokens).toBeLessThan(50);
  });
});
