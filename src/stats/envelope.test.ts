import { describe, it, expect } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { dir as tmpDir } from "tmp-promise";
import { EnvelopeLogger, summarizeEnvelopeLog } from "./envelope.js";

describe("EnvelopeLogger", () => {
  it("appends one JSON line per record", async () => {
    const t = await tmpDir({ unsafeCleanup: true });
    try {
      const logger = new EnvelopeLogger("session-A", t.path);
      await logger.init();
      await logger.record({ toolCall: "ParecodeSearch", bytesReturned: 1234, durationMs: 56, isError: false });
      await logger.record({ toolCall: "ParecodeEdit", bytesReturned: 78, durationMs: 9, isError: true });
      await logger.flush();

      const contents = await fs.readFile(path.join(t.path, "envelope.jsonl"), "utf-8");
      const lines = contents.trim().split("\n");
      expect(lines).toHaveLength(2);

      const first = JSON.parse(lines[0]);
      expect(first.sessionId).toBe("session-A");
      expect(first.toolCall).toBe("ParecodeSearch");
      expect(first.bytesReturned).toBe(1234);
      expect(first.durationMs).toBe(56);
      expect(first.isError).toBe(false);
      expect(first.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    } finally {
      await t.cleanup();
    }
  });

  it("preserves existing log on re-init", async () => {
    const t = await tmpDir({ unsafeCleanup: true });
    try {
      const logger1 = new EnvelopeLogger("s1", t.path);
      await logger1.init();
      await logger1.record({ toolCall: "ParecodeSearch", bytesReturned: 100, durationMs: 1, isError: false });
      await logger1.flush();

      const logger2 = new EnvelopeLogger("s2", t.path);
      await logger2.init();
      await logger2.record({ toolCall: "ParecodeEdit", bytesReturned: 200, durationMs: 2, isError: false });
      await logger2.flush();

      const contents = await fs.readFile(path.join(t.path, "envelope.jsonl"), "utf-8");
      expect(contents.trim().split("\n")).toHaveLength(2);
    } finally {
      await t.cleanup();
    }
  });
});

describe("summarizeEnvelopeLog", () => {
  it("aggregates per tool with mean and percentiles", async () => {
    const t = await tmpDir({ unsafeCleanup: true });
    try {
      const logger = new EnvelopeLogger("s", t.path);
      await logger.init();
      for (const n of [100, 200, 300, 400, 500]) {
        await logger.record({ toolCall: "ParecodeSearch", bytesReturned: n, durationMs: n / 10, isError: false });
      }
      await logger.record({ toolCall: "ParecodeSearch", bytesReturned: 50, durationMs: 5, isError: true });
      await logger.record({ toolCall: "ParecodeEdit", bytesReturned: 10, durationMs: 1, isError: false });
      await logger.flush();

      const summaries = await summarizeEnvelopeLog(path.join(t.path, "envelope.jsonl"), 0);
      expect(summaries).toHaveLength(2);

      const search = summaries.find((s) => s.toolCall === "ParecodeSearch")!;
      expect(search.calls).toBe(6);
      expect(search.errors).toBe(1);
      expect(search.totalBytes).toBe(1550);
      expect(search.meanBytes).toBe(258);
      expect(search.p50Bytes).toBeGreaterThan(0);
      expect(search.p95Bytes).toBeGreaterThan(search.p50Bytes);
    } finally {
      await t.cleanup();
    }
  });

  it("returns empty when log does not exist", async () => {
    const summaries = await summarizeEnvelopeLog("/tmp/parecode-does-not-exist.jsonl", 0);
    expect(summaries).toEqual([]);
  });

  it("filters by cutoff", async () => {
    const t = await tmpDir({ unsafeCleanup: true });
    try {
      const logFile = path.join(t.path, "envelope.jsonl");
      const oldRec = JSON.stringify({ timestamp: "2020-01-01T00:00:00Z", sessionId: "s", toolCall: "X", bytesReturned: 1, durationMs: 1, isError: false });
      const newRec = JSON.stringify({ timestamp: new Date().toISOString(), sessionId: "s", toolCall: "Y", bytesReturned: 2, durationMs: 2, isError: false });
      await fs.writeFile(logFile, oldRec + "\n" + newRec + "\n");

      const summaries = await summarizeEnvelopeLog(logFile, Date.now() - 60_000);
      expect(summaries).toHaveLength(1);
      expect(summaries[0].toolCall).toBe("Y");
    } finally {
      await t.cleanup();
    }
  });
});
