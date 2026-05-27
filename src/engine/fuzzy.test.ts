import { describe, it, expect } from "vitest";
import { findFuzzyMatch, getLevenshteinDistance } from "./fuzzy.js";

describe("Fuzzy Match", () => {
  it("should calculate levenshtein distance correctly", () => {
    expect(getLevenshteinDistance("kitten", "sitting")).toBe(3);
    expect(getLevenshteinDistance("flaw", "lawn")).toBe(2);
    expect(getLevenshteinDistance("", "a")).toBe(1);
    expect(getLevenshteinDistance("a", "")).toBe(1);
    expect(getLevenshteinDistance("abc", "abc")).toBe(0);
  });

  it("should match strings ignoring whitespace", () => {
    const content = "const   a  = \n 1;";
    const search = "const a = 1;";
    
    const result = findFuzzyMatch(content, search);
    expect(result).not.toBeNull();
    expect(result?.confidence).toBe(1.0);
    expect(result?.matchedText).toBe("const   a  = \n 1;");
  });

  it("should match with high confidence on minor typos", () => {
    const content = "const a = 1;";
    const search = "const b = 1;";
    
    const result = findFuzzyMatch(content, search);
    expect(result).not.toBeNull();
    expect(result?.confidence).toBeGreaterThanOrEqual(0.85);
    expect(result?.matchedText).toBe("const a = 1;");
  });

  it("should fail closed on low confidence", () => {
    const content = "const myVar = 1;";
    const search = "const yourVar = 1;";
    
    const result = findFuzzyMatch(content, search);
    expect(result).toBeNull();
  });

  it("should match with aggressive unicode normalization if enabled", () => {
    const content = "const re\u0301sume\u0301 = 1;";
    const search = "const résumé = 1;";
    
    const resultNormal = findFuzzyMatch(content, search, false);
    expect(resultNormal).toBeNull();
    
    const resultAggressive = findFuzzyMatch(content, search, true);
    expect(resultAggressive).not.toBeNull();
    expect(resultAggressive?.confidence).toBe(1.0);
    expect(resultAggressive?.matchedText).toBe("const re\u0301sume\u0301 = 1;");
  });

  it("should fail gracefully on empty search", () => {
    const content = "const a = 1;";
    const result = findFuzzyMatch(content, "");
    expect(result).toBeNull();
  });
});
