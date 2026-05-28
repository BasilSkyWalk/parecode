import { describe, it, expect } from "vitest";
import { parseTranscriptLine } from "./transcriptParser.js";

describe("transcriptParser", () => {
  it("returns null for empty lines", () => {
    expect(parseTranscriptLine("")).toBeNull();
    expect(parseTranscriptLine("   ")).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    expect(parseTranscriptLine("{ invalid json")).toBeNull();
  });

  it("extracts fields from canonical Claude Code shape", () => {
    const line = JSON.stringify({
      type: "tool_call",
      toolName: "Grep",
      input: { pattern: "test", path: "src" },
      tokens: { input: 100, output: 50 },
    });
    const parsed = parseTranscriptLine(line);
    expect(parsed).toBeDefined();
    expect(parsed?.type).toBe("tool_call");
    expect(parsed?.toolName).toBe("Grep");
    expect(parsed?.input).toEqual({ pattern: "test", path: "src" });
    expect(parsed?.tokens).toEqual({ input: 100, output: 50 });
  });

  it("handles drifted schema variants for toolName", () => {
    const vars = [
      { tool_name: "Grep" },
      { toolCall: { name: "Grep" } },
      { name: "Grep" },
    ];
    for (const v of vars) {
      const parsed = parseTranscriptLine(JSON.stringify(v));
      expect(parsed?.toolName).toBe("Grep");
    }
  });

  it("handles stringified input payloads", () => {
    const line = JSON.stringify({
      toolName: "Grep",
      input: JSON.stringify({ pattern: "foo" }),
    });
    const parsed = parseTranscriptLine(line);
    expect(parsed?.input).toEqual({ pattern: "foo" });
  });

  it("gracefully degrades when fields are missing or wrong type", () => {
    const line = JSON.stringify({
      toolName: 123,
      input: ["array is not an object, well technically it is but it parses fine"],
      tokens: { input: "many" },
    });
    const parsed = parseTranscriptLine(line);
    expect(parsed?.toolName).toBeUndefined();
    expect(parsed?.tokens?.input).toBeUndefined();
    expect(parsed?.input).toEqual({});
  });

  it("filters out non-structured fields by default", () => {
    const line = JSON.stringify({
      toolName: "Edit",
      input: { path: "src", fileText: "secret", command: "ls" },
    });
    const parsed = parseTranscriptLine(line);
    expect(parsed?.input).toEqual({ path: "src" });

    const parsedWithContent = parseTranscriptLine(line, true);
    expect(parsedWithContent?.input).toEqual({ path: "src", fileText: "secret", command: "ls" });
  });
});
