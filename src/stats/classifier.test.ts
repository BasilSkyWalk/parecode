import { describe, it, expect } from "vitest";
import { classifyToolCalls } from "./classifier.js";
import { TranscriptRecord } from "./transcriptParser.js";

describe("classifyToolCalls", () => {
  it("classifies pure search tools as replaceable_search", () => {
    const records: TranscriptRecord[] = [
      { toolName: "Grep" },
      { toolName: "Glob" },
    ];
    expect(classifyToolCalls(records)).toEqual([
      "replaceable_search",
      "replaceable_search",
    ]);
  });

  it("classifies bash search commands as replaceable_search", () => {
    const records: TranscriptRecord[] = [
      { toolName: "Bash", input: { command: "grep -r foo ." } },
      { toolName: "Bash", input: { command: "find . -name '*.ts' | xargs grep foo" } },
      { toolName: "Bash", input: { command: "ls -la" } },
    ];
    expect(classifyToolCalls(records)).toEqual([
      "replaceable_search",
      "replaceable_search",
      "unchanged",
    ]);
  });

  it("classifies edit tools as replaceable_edit", () => {
    const records: TranscriptRecord[] = [
      { toolName: "Edit" },
      { toolName: "MultiEdit" },
      { toolName: "Write" },
    ];
    expect(classifyToolCalls(records)).toEqual([
      "replaceable_edit",
      "replaceable_edit",
      "replaceable_edit",
    ]);
  });

  it("classifies Read calls following a search within the same turn as read_followups", () => {
    const records: TranscriptRecord[] = [
      { type: "user" },
      { toolName: "Grep" },
      { toolName: "Read" },
      { toolName: "Bash", input: { command: "ls" } },
      { toolName: "Read" },
      { type: "user" },
      { toolName: "Read" },
    ];
    expect(classifyToolCalls(records)).toEqual([
      null,
      "replaceable_search",
      "read_followups",
      "unchanged",
      "read_followups",
      null,
      "unchanged",
    ]);
  });

  it("classifies other tools as unchanged", () => {
    const records: TranscriptRecord[] = [
      { toolName: "FileContents" },
      { toolName: "Run" },
    ];
    expect(classifyToolCalls(records)).toEqual(["unchanged", "unchanged"]);
  });

  it("returns null for non-tool records", () => {
    const records: TranscriptRecord[] = [
      { type: "assistant" },
      { toolName: "Grep" },
    ];
    expect(classifyToolCalls(records)).toEqual([null, "replaceable_search"]);
  });
});
