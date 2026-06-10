import { describe, it, expect } from "vitest";
import { dir } from "tmp-promise";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { pruneSessions, truncateEnvelope, runStartupCleanup, ENVELOPE_MAX_BYTES, ENVELOPE_KEEP_BYTES } from "./retention.js";

const DAY_MS = 24 * 60 * 60 * 1000;

async function writeAged(filePath: string, content: string, ageDays: number) {
  await fs.writeFile(filePath, content, "utf-8");
  const when = new Date(Date.now() - ageDays * DAY_MS);
  await fs.utimes(filePath, when, when);
}

describe("retention", () => {
  describe("pruneSessions", () => {
    it("deletes session files older than the retention window and keeps fresh ones and index.json", async () => {
      const tmp = await dir({ unsafeCleanup: true });
      const sessions = path.join(tmp.path, "sessions");
      await fs.mkdir(sessions);
      await writeAged(path.join(sessions, "old.jsonl"), "{}", 40);
      await writeAged(path.join(sessions, "old-memory.json"), "{}", 40);
      await writeAged(path.join(sessions, "parecode-spill-1.json"), "{}", 40);
      await writeAged(path.join(sessions, "fresh.jsonl"), "{}", 1);
      await writeAged(path.join(sessions, "index.json"), "[]", 40);

      const deleted = await pruneSessions(tmp.path, 30);

      expect(deleted).toBe(3);
      const remaining = (await fs.readdir(sessions)).sort();
      expect(remaining).toEqual(["fresh.jsonl", "index.json"]);
      await tmp.cleanup();
    });

    it("drops rollup entries older than the cutoff from index.json", async () => {
      const tmp = await dir({ unsafeCleanup: true });
      const sessions = path.join(tmp.path, "sessions");
      await fs.mkdir(sessions);
      const oldStart = new Date(Date.now() - 40 * DAY_MS).toISOString();
      const freshStart = new Date(Date.now() - 1 * DAY_MS).toISOString();
      await fs.writeFile(
        path.join(sessions, "index.json"),
        JSON.stringify([
          { sessionId: "old", startTime: oldStart, totalCalls: 1, totalCallsBatched: 0, totalEstimatedTokensSaved: 0 },
          { sessionId: "fresh", startTime: freshStart, totalCalls: 1, totalCallsBatched: 0, totalEstimatedTokensSaved: 0 },
        ]),
        "utf-8"
      );

      await pruneSessions(tmp.path, 30);

      const rollup = JSON.parse(await fs.readFile(path.join(sessions, "index.json"), "utf-8"));
      expect(rollup.map((r: { sessionId: string }) => r.sessionId)).toEqual(["fresh"]);
      await tmp.cleanup();
    });

    it("returns 0 when the sessions directory does not exist", async () => {
      const tmp = await dir({ unsafeCleanup: true });
      const deleted = await pruneSessions(tmp.path, 30);
      expect(deleted).toBe(0);
      await tmp.cleanup();
    });
  });

  describe("truncateEnvelope", () => {
    it("keeps only the newest lines within the keep budget when the log exceeds the cap", async () => {
      const tmp = await dir({ unsafeCleanup: true });
      const line = (i: number) => JSON.stringify({ seq: i, pad: "x".repeat(1000) });
      const lines = Array.from({ length: 6000 }, (_, i) => line(i));
      await fs.writeFile(path.join(tmp.path, "envelope.jsonl"), lines.join("\n") + "\n", "utf-8");

      const truncated = await truncateEnvelope(tmp.path);

      expect(truncated).toBe(true);
      const after = await fs.readFile(path.join(tmp.path, "envelope.jsonl"), "utf-8");
      expect(after.length).toBeLessThanOrEqual(ENVELOPE_KEEP_BYTES);
      const kept = after.trim().split("\n").map((l) => JSON.parse(l));
      expect(kept[kept.length - 1].seq).toBe(5999);
      expect(kept[0].seq).toBeGreaterThan(0);
      expect(after.endsWith("\n")).toBe(true);
      await tmp.cleanup();
    });

    it("leaves the log untouched when under the cap", async () => {
      const tmp = await dir({ unsafeCleanup: true });
      const content = JSON.stringify({ seq: 1 }) + "\n";
      await fs.writeFile(path.join(tmp.path, "envelope.jsonl"), content, "utf-8");

      const truncated = await truncateEnvelope(tmp.path);

      expect(truncated).toBe(false);
      expect(await fs.readFile(path.join(tmp.path, "envelope.jsonl"), "utf-8")).toBe(content);
      await tmp.cleanup();
    });

    it("returns false when no envelope log exists", async () => {
      const tmp = await dir({ unsafeCleanup: true });
      expect(await truncateEnvelope(tmp.path)).toBe(false);
      await tmp.cleanup();
    });
  });

  describe("runStartupCleanup", () => {
    it("prunes old sessions and truncates the envelope in one pass", async () => {
      const tmp = await dir({ unsafeCleanup: true });
      const sessions = path.join(tmp.path, "sessions");
      await fs.mkdir(sessions);
      await writeAged(path.join(sessions, "old.jsonl"), "{}", 40);
      const big = "x".repeat(ENVELOPE_MAX_BYTES + 1024);
      await fs.writeFile(path.join(tmp.path, "envelope.jsonl"), big.replace(/x{1000}/g, "x".repeat(999) + "\n"), "utf-8");

      const logged: string[] = [];
      await runStartupCleanup(tmp.path, (msg) => logged.push(msg));

      expect(await fs.readdir(sessions)).toEqual([]);
      const stat = await fs.stat(path.join(tmp.path, "envelope.jsonl"));
      expect(stat.size).toBeLessThanOrEqual(ENVELOPE_KEEP_BYTES);
      expect(logged.length).toBeGreaterThan(0);
      await tmp.cleanup();
    });

    it("never throws when the data dir is missing", async () => {
      await expect(runStartupCleanup("/nonexistent/parecode-data")).resolves.toBeUndefined();
    });
  });
});
