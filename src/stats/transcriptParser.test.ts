import { describe, it, expect } from "vitest";
import { parseTranscriptLine } from "./transcriptParser.js";

describe("transcriptParser", () => {
  it("returns empty array for empty lines", () => {
    expect(parseTranscriptLine("")).toEqual([]);
    expect(parseTranscriptLine("   ")).toEqual([]);
  });

  it("returns empty array for invalid JSON", () => {
    expect(parseTranscriptLine("{ invalid json")).toEqual([]);
  });

  it("extracts fields from canonical Claude Code assistant shape with nested tool_use", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        usage: { input_tokens: 100, output_tokens: 50 },
        content: [
          { type: "text", text: "ok" },
          { type: "tool_use", name: "Grep", input: { pattern: "test", path: "src" } },
        ],
      },
    });
    const parsed = parseTranscriptLine(line);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].type).toBe("tool_call");
    expect(parsed[0].toolName).toBe("Grep");
    expect(parsed[0].input).toEqual({ pattern: "test", path: "src" });
    expect(parsed[0].tokens).toEqual({ input: 100, output: 50 });
  });

  it("emits one record per tool_use block in a multi-tool assistant turn", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        usage: { input_tokens: 200, output_tokens: 80 },
        content: [
          { type: "tool_use", name: "Grep", input: { pattern: "a" } },
          { type: "tool_use", name: "Read", input: { path: "x.ts" } },
        ],
      },
    });
    const parsed = parseTranscriptLine(line);
    expect(parsed.map((r) => r.toolName)).toEqual(["Grep", "Read"]);
    expect(parsed.every((r) => r.tokens?.output === 80)).toBe(true);
  });

  it("emits a user record for type:user lines so the classifier can anchor follow-ups", () => {
    const line = JSON.stringify({ type: "user", message: { content: "hi" } });
    const parsed = parseTranscriptLine(line);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].type).toBe("user");
    expect(parsed[0].toolName).toBeUndefined();
  });

  it("ignores assistant lines with no tool_use blocks", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        usage: { input_tokens: 10, output_tokens: 5 },
        content: [{ type: "text", text: "just talking" }],
      },
    });
    expect(parseTranscriptLine(line)).toEqual([]);
  });

  it("supports legacy flat shape", () => {
    const line = JSON.stringify({
      type: "tool_call",
      toolName: "Grep",
      input: { pattern: "test", path: "src" },
      tokens: { input: 100, output: 50 },
    });
    const parsed = parseTranscriptLine(line);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].toolName).toBe("Grep");
    expect(parsed[0].input).toEqual({ pattern: "test", path: "src" });
    expect(parsed[0].tokens).toEqual({ input: 100, output: 50 });
  });

  it("handles drifted legacy variants for toolName", () => {
    const vars = [
      { tool_name: "Grep" },
      { toolCall: { name: "Grep" } },
      { name: "Grep" },
    ];
    for (const v of vars) {
      const parsed = parseTranscriptLine(JSON.stringify(v));
      expect(parsed[0]?.toolName).toBe("Grep");
    }
  });

  it("handles stringified input payloads", () => {
    const line = JSON.stringify({
      toolName: "Grep",
      input: JSON.stringify({ pattern: "foo" }),
    });
    const parsed = parseTranscriptLine(line);
    expect(parsed[0]?.input).toEqual({ pattern: "foo" });
  });

  it("gracefully degrades when fields are missing or wrong type", () => {
    const line = JSON.stringify({
      toolName: 123,
      input: ["array is not an object, well technically it is but it parses fine"],
      tokens: { input: "many" },
    });
    expect(parseTranscriptLine(line)).toEqual([]);
  });

  it("filters out non-structured fields by default", () => {
    const line = JSON.stringify({
      toolName: "Edit",
      input: { path: "src", fileText: "secret", command: "ls" },
    });
    const parsed = parseTranscriptLine(line);
    expect(parsed[0]?.input).toEqual({ path: "src" });

    const parsedWithContent = parseTranscriptLine(line, true);
    expect(parsedWithContent[0]?.input).toEqual({ path: "src", fileText: "secret", command: "ls" });
  });
});
