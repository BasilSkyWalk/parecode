import { describe, it, expect, vi } from "vitest";
import { runRetroactiveScan } from "./retroactiveScan.js";
import * as claudeCodeTranscripts from "../infra/claudeCodeTranscripts.js";
import * as transcriptParser from "./transcriptParser.js";
import * as fs from "node:fs/promises";

vi.mock("../infra/claudeCodeTranscripts.js", () => ({
  transcriptDirExists: vi.fn(),
  listProjectDirs: vi.fn(),
  listSessionFiles: vi.fn(),
  decodeProjectName: vi.fn(),
}));

vi.mock("./transcriptParser.js", () => ({
  parseTranscriptFile: vi.fn(),
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    stat: vi.fn(),
  };
});

describe("runRetroactiveScan", () => {
  it("returns zero stats if transcript dir doesn't exist", async () => {
    vi.mocked(claudeCodeTranscripts.transcriptDirExists).mockResolvedValue(false);
    const result = await runRetroactiveScan(0);
    expect(result.sessions).toBe(0);
    expect(result.toolCalls).toBe(0);
  });

  it("filters out old session files by mtime", async () => {
    vi.mocked(claudeCodeTranscripts.transcriptDirExists).mockResolvedValue(true);
    vi.mocked(claudeCodeTranscripts.listProjectDirs).mockResolvedValue(["/proj1"]);
    vi.mocked(claudeCodeTranscripts.listSessionFiles).mockResolvedValue(["/proj1/old.jsonl", "/proj1/new.jsonl"]);
    
    vi.mocked(fs.stat).mockImplementation(async (file: string | Buffer | URL) => {
      const f = file.toString();
      if (f.endsWith("old.jsonl")) return { mtimeMs: 1000 } as any;
      if (f.endsWith("new.jsonl")) return { mtimeMs: 5000 } as any;
      throw new Error("not found");
    });

    vi.mocked(transcriptParser.parseTranscriptFile).mockResolvedValue([{
      type: "tool_call",
      toolName: "Grep",
      input: { pattern: "foo" },
      tokens: { input: 100, output: 500 }
    }]);

    const result = await runRetroactiveScan(3000);
    // Only new.jsonl should be parsed
    expect(transcriptParser.parseTranscriptFile).toHaveBeenCalledTimes(1);
    expect(transcriptParser.parseTranscriptFile).toHaveBeenCalledWith("/proj1/new.jsonl");
    expect(result.sessions).toBe(1);
    expect(result.toolCalls).toBe(1);
  });

  it("accumulates token savings using the classifier", async () => {
    vi.mocked(claudeCodeTranscripts.transcriptDirExists).mockResolvedValue(true);
    vi.mocked(claudeCodeTranscripts.listProjectDirs).mockResolvedValue(["/proj1"]);
    vi.mocked(claudeCodeTranscripts.listSessionFiles).mockResolvedValue(["/proj1/file.jsonl"]);
    vi.mocked(fs.stat).mockResolvedValue({ mtimeMs: 5000 } as any);

    // Provide a mix of calls:
    // 1 search, 1 read followup, 1 edit, 1 unchanged
    vi.mocked(transcriptParser.parseTranscriptFile).mockResolvedValue([
      { type: "user" },
      { toolName: "Grep", tokens: { input: 10, output: 200 } }, // actual = 200, parecode ~ small env overhead, diff is big
      { toolName: "Read", tokens: { input: 50, output: 100 } }, // followup: saved 150
      { toolName: "Edit", tokens: { input: 1000, output: 50 } }, // edit: 1000 * 0.3 = 300
      { toolName: "Bash", input: { command: "ls" } } // unchanged
    ]);

    const result = await runRetroactiveScan(0);

    expect(result.sessions).toBe(1);
    expect(result.toolCalls).toBe(4);
    expect(result.estimatedTokensSaved).toBeGreaterThan(0);
    // Read followup saves 150
    // Edit saves 300
    // Grep saves ~0 (actualTokens is 200, parecode estimation is > 200 because of envelope)
    // Total is ~450
    expect(result.estimatedTokensSaved).toBe(450);
  });
});
