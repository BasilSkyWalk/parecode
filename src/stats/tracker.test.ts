import { describe, it, expect } from "vitest";
import { dir } from "tmp-promise";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { loadRollupWithInflight } from "./tracker.js";

describe("loadRollupWithInflight", () => {
  it("returns empty rollup when session dir does not exist", async () => {
    const tmp = await dir({ unsafeCleanup: true });
    const result = await loadRollupWithInflight(path.join(tmp.path, "missing"));
    expect(result.rollup).toEqual([]);
    expect(result.inflightCount).toBe(0);
    await tmp.cleanup();
  });

  it("aggregates an in-flight .jsonl session not yet in the rollup", async () => {
    const tmp = await dir({ unsafeCleanup: true });
    const sessionId = "abc-inflight";
    const log = [
      JSON.stringify({ timestamp: "2026-05-28T10:00:00.000Z", callsBatched: 2, estimatedTokensSaved: 300 }),
      JSON.stringify({ timestamp: "2026-05-28T10:01:00.000Z", callsBatched: 3, estimatedTokensSaved: 700 }),
    ].join("\n") + "\n";
    await fs.writeFile(path.join(tmp.path, `${sessionId}.jsonl`), log, "utf-8");

    const { rollup, inflightCount } = await loadRollupWithInflight(tmp.path);

    expect(inflightCount).toBe(1);
    expect(rollup).toHaveLength(1);
    expect(rollup[0]).toMatchObject({
      sessionId,
      totalCalls: 2,
      totalCallsBatched: 5,
      totalEstimatedTokensSaved: 1000,
      startTime: "2026-05-28T10:00:00.000Z",
      endTime: "2026-05-28T10:01:00.000Z",
    });
    await tmp.cleanup();
  });

  it("does not double-count a session that already exists in the rollup", async () => {
    const tmp = await dir({ unsafeCleanup: true });
    const sessionId = "already-rolled-up";
    await fs.writeFile(
      path.join(tmp.path, "index.json"),
      JSON.stringify([
        {
          sessionId,
          startTime: "2026-05-27T00:00:00.000Z",
          endTime: "2026-05-27T00:05:00.000Z",
          totalCalls: 4,
          totalCallsBatched: 2,
          totalEstimatedTokensSaved: 500,
        },
      ]),
      "utf-8",
    );
    await fs.writeFile(
      path.join(tmp.path, `${sessionId}.jsonl`),
      JSON.stringify({ timestamp: "2026-05-27T00:00:30.000Z", callsBatched: 1, estimatedTokensSaved: 100 }) + "\n",
      "utf-8",
    );

    const { rollup, inflightCount } = await loadRollupWithInflight(tmp.path);

    expect(inflightCount).toBe(0);
    expect(rollup).toHaveLength(1);
    expect(rollup[0].totalCalls).toBe(4);
    await tmp.cleanup();
  });

  it("merges rolled-up sessions and in-flight sessions together", async () => {
    const tmp = await dir({ unsafeCleanup: true });
    await fs.writeFile(
      path.join(tmp.path, "index.json"),
      JSON.stringify([{ sessionId: "old", startTime: "2026-05-01T00:00:00.000Z", totalCalls: 1, totalCallsBatched: 0, totalEstimatedTokensSaved: 0 }]),
      "utf-8",
    );
    await fs.writeFile(
      path.join(tmp.path, "fresh.jsonl"),
      JSON.stringify({ timestamp: "2026-05-28T00:00:00.000Z", callsBatched: 4, estimatedTokensSaved: 800 }) + "\n",
      "utf-8",
    );

    const { rollup, inflightCount } = await loadRollupWithInflight(tmp.path);

    expect(inflightCount).toBe(1);
    expect(rollup.map((r) => r.sessionId).sort()).toEqual(["fresh", "old"]);
    await tmp.cleanup();
  });
});
