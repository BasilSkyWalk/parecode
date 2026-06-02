import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { assessPatterns } from "./patternAssessment.js";
import { SessionMemory, createSessionMemory } from "./sessionMemory.js";

describe("assessPatterns", () => {
  it("detects pattern_directory_collision when pattern is a substring of a directory", () => {
    const memory = createSessionMemory("test");
    const result = assessPatterns(["MiniGame"], ["src/MiniGames", "src/Other"], memory);
    
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      kind: "pattern_directory_collision",
      pattern: "MiniGame",
      detail: expect.stringContaining("Consider more specific symbols")
    });
  });

  it("is case-insensitive for directory collisions", () => {
    const memory = createSessionMemory("test");
    const result = assessPatterns(["USER"], ["src/users"], memory);
    
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe("pattern_directory_collision");
  });

  it("ignores short patterns for directory collisions", () => {
    const memory = createSessionMemory("test");
    // "id" is 2 chars, which is < 3
    const result = assessPatterns(["id"], ["src/identifiers"], memory);
    
    expect(result).toHaveLength(0);
  });

  it("returns no warnings if directories don't match", () => {
    const memory = createSessionMemory("test");
    const result = assessPatterns(["MiniGame"], ["src/Users", "src/Cards"], memory);
    
    expect(result).toHaveLength(0);
  });

  it("is monotonic with respect to history (property test)", () => {
    // For now, history doesn't affect pattern_directory_collision.
    // When prior_overflow_recurrence is implemented, more history might add warnings.
    // We just verify that (warnings with history1) subset of (warnings with history1 + history2)
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1, maxLength: 20 }), { maxLength: 5 }),
        fc.array(fc.string({ minLength: 1, maxLength: 20 }), { maxLength: 5 }),
        (patterns, dirs) => {
          const memory = createSessionMemory("test");
          const result1 = assessPatterns(patterns, dirs, memory);
          
          // Add some fake spills to memory
          const memory2: SessionMemory = {
            ...memory,
            spills: [
              { path: "fake1", createdAt: 1, consumed: false, fromCallId: "1" },
              { path: "fake2", createdAt: 2, consumed: false, fromCallId: "2" }
            ]
          };
          
          const result2 = assessPatterns(patterns, dirs, memory2);
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
