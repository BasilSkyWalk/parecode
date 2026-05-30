import { describe, it, expect } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { dir as tmpDir } from "tmp-promise";
import { summarizeSessionTokens } from "./sessionTokens.js";

function assistantLine(opts: {
  id?: string;
  input?: number;
  cacheRead?: number;
  cacheCreate?: number;
  output?: number;
  timestamp?: string;
}): string {
  return JSON.stringify({
    type: "assistant",
    timestamp: opts.timestamp,
    message: {
      id: opts.id,
      content: [{ type: "text", text: "hi" }],
      usage: {
        input_tokens: opts.input,
        cache_read_input_tokens: opts.cacheRead,
        cache_creation_input_tokens: opts.cacheCreate,
        output_tokens: opts.output,
      },
    },
  });
}

describe("summarizeSessionTokens", () => {
  it("sums usage per assistant turn", async () => {
    const t = await tmpDir({ unsafeCleanup: true });
    try {
      const f = path.join(t.path, "abcd-1234.jsonl");
      const lines = [
        assistantLine({ id: "m1", input: 100, cacheRead: 1000, cacheCreate: 50, output: 200, timestamp: "2026-05-30T10:00:00Z" }),
        JSON.stringify({ type: "user", message: { content: "hello" } }),
        assistantLine({ id: "m2", input: 50, cacheRead: 1500, output: 300, timestamp: "2026-05-30T10:01:00Z" }),
      ];
      await fs.writeFile(f, lines.join("\n") + "\n");

      const summary = await summarizeSessionTokens(f);
      expect(summary.sessionId).toBe("abcd-1234");
      expect(summary.assistantTurns).toBe(2);
      expect(summary.inputTokens).toBe(150);
      expect(summary.cacheReadTokens).toBe(2500);
      expect(summary.cacheCreateTokens).toBe(50);
      expect(summary.outputTokens).toBe(500);
      expect(summary.firstTimestamp).toBe("2026-05-30T10:00:00Z");
      expect(summary.lastTimestamp).toBe("2026-05-30T10:01:00Z");
    } finally {
      await t.cleanup();
    }
  });

  it("dedupes by message id", async () => {
    const t = await tmpDir({ unsafeCleanup: true });
    try {
      const f = path.join(t.path, "s.jsonl");
      const lines = [
        assistantLine({ id: "m1", input: 100, output: 200 }),
        assistantLine({ id: "m1", input: 100, output: 200 }),
      ];
      await fs.writeFile(f, lines.join("\n") + "\n");

      const summary = await summarizeSessionTokens(f);
      expect(summary.assistantTurns).toBe(1);
      expect(summary.inputTokens).toBe(100);
      expect(summary.outputTokens).toBe(200);
    } finally {
      await t.cleanup();
    }
  });

  it("ignores user lines and malformed JSON", async () => {
    const t = await tmpDir({ unsafeCleanup: true });
    try {
      const f = path.join(t.path, "s.jsonl");
      const lines = [
        JSON.stringify({ type: "user", message: { content: "hi" } }),
        "not json",
        assistantLine({ id: "m1", input: 10, output: 20 }),
      ];
      await fs.writeFile(f, lines.join("\n") + "\n");

      const summary = await summarizeSessionTokens(f);
      expect(summary.assistantTurns).toBe(1);
      expect(summary.inputTokens).toBe(10);
      expect(summary.outputTokens).toBe(20);
    } finally {
      await t.cleanup();
    }
  });

  it("returns empty summary for nonexistent file", async () => {
    const summary = await summarizeSessionTokens("/tmp/parecode-does-not-exist.jsonl");
    expect(summary.assistantTurns).toBe(0);
    expect(summary.inputTokens).toBe(0);
  });
});
