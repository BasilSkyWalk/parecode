import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { assessPatterns } from "./patternAssessment.js";
import { SessionMemory, createSessionMemory } from "./sessionMemory.js";

describe("assessPatterns", () => {
  it("detects pattern_directory_collision when pattern is a substring of a directory", () => {
    const memory = createSessionMemory("test");
    const result = assessPatterns(["MiniGame"], undefined, ["src/MiniGames", "src/Other"], memory);
    
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      kind: "pattern_directory_collision",
      pattern: "MiniGame",
      detail: expect.stringContaining("Consider more specific symbols")
    });
  });

  it("is case-insensitive for directory collisions", () => {
    const memory = createSessionMemory("test");
    const result = assessPatterns(["USER"], undefined, ["src/users"], memory);
    
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe("pattern_directory_collision");
  });

  it("ignores short patterns for directory collisions", () => {
    const memory = createSessionMemory("test");
    const result = assessPatterns(["id"], undefined, ["src/identifiers"], memory);
    
    expect(result.some(r => r.kind === "pattern_directory_collision")).toBe(false);
  });

  it("returns no warnings if directories don't match and pattern is long enough", () => {
    const memory = createSessionMemory("test");
    const result = assessPatterns(["MiniGame"], undefined, ["src/Users", "src/Cards"], memory);
    
    expect(result).toHaveLength(0);
  });

  it("detects pattern_too_short when pattern has fewer than 4 symbol chars", () => {
    const memory = createSessionMemory("test");
    const result = assessPatterns(["id", "a+b=c", "long_enough_pattern"], undefined, [], memory);
    
    expect(result).toHaveLength(2);
    expect(result[0].kind).toBe("pattern_too_short");
    expect(result[0].pattern).toBe("id");
    expect(result[1].kind).toBe("pattern_too_short");
    expect(result[1].pattern).toBe("a+b=c");
  });

  it("detects prior_overflow_recurrence when paths match exactly and patterns overlap", () => {
    let memory = createSessionMemory("test");
    memory = {
      ...memory,
      spills: [{
        path: "/tmp/spill1",
        createdAt: 1,
        consumed: false,
        fromCallId: "1",
        patterns: ["MiniGame", "OtherPattern"],
        paths: ["src/MiniGames"]
      }]
    };
    
    const result1 = assessPatterns(["MiniGame"], ["src/MiniGames"], [], memory);
    expect(result1).toHaveLength(1);
    expect(result1[0].kind).toBe("prior_overflow_recurrence");
    
    const result2 = assessPatterns(["MiniGame"], ["src/Other"], [], memory);
    expect(result2).toHaveLength(0);

    const result3 = assessPatterns(["OtherPattern"], ["src/MiniGames"], [], memory);
    expect(result3).toHaveLength(1);
    expect(result3[0].kind).toBe("prior_overflow_recurrence");
  });

  it("is monotonic with respect to history (property test)", () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 4, maxLength: 20 }).filter(s => s.replace(/[^A-Za-z0-9_]/g, "").length >= 4), { maxLength: 5 }),
        fc.array(fc.string({ minLength: 1, maxLength: 20 }), { maxLength: 5 }),
        (patterns, dirs) => {
          const memory = createSessionMemory("test");
          const result1 = assessPatterns(patterns, undefined, dirs, memory);
          
          const memory2: SessionMemory = {
            ...memory,
            spills: [
              { path: "fake1", createdAt: 1, consumed: false, fromCallId: "1", patterns: ["fake1"], paths: ["fake1"] },
              { path: "fake2", createdAt: 2, consumed: false, fromCallId: "2", patterns: ["fake2"], paths: ["fake2"] }
            ]
          };
          
          const result2 = assessPatterns(patterns, undefined, dirs, memory2);
          expect(result2.length).toBeGreaterThanOrEqual(result1.length);
          
          for (const w1 of result1) {
            const found = result2.some(w2 => w2.pattern === w1.pattern && w2.kind === w1.kind);
            expect(found).toBe(true);
          }
        }
      )
    );
  });
});
