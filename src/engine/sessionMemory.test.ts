import { describe, it, expect } from "vitest";
import { dir } from "tmp-promise";
import * as fs from "node:fs/promises";
import {
  createSessionMemory,
  load,
  persist,
  recordReturnedWindows,
  recordSpill,
  recordPatternWarning,
  sessionFilePath,
  MAX_RETURNED_WINDOWS,
  MAX_SPILLS,
  ReturnedWindow,
  Spill,
  SessionMemoryIo,
} from "./sessionMemory.js";

const io: SessionMemoryIo = {
  readFile: (p) => fs.readFile(p, "utf-8"),
  writeFile: (p, c) => fs.writeFile(p, c, "utf-8"),
};

function window(file: string, startLine: number): ReturnedWindow {
  return { file, startLine, endLine: startLine + 4, returnedAt: startLine, fromCallId: `call-${startLine}` };
}

function spill(seq: number): Spill {
  return { path: `/tmp/spill-${seq}.txt`, createdAt: seq, consumed: false, fromCallId: `call-${seq}` };
}

describe("sessionMemory load/persist", () => {
  it("round-trips a populated memory through the filesystem", async () => {
    const tmp = await dir({ unsafeCleanup: true });
    let memory = createSessionMemory("session-1", 1000);
    memory = recordReturnedWindows(memory, [window("a.ts", 10), window("b.ts", 20)]);
    memory = recordSpill(memory, spill(1));
    memory = recordPatternWarning(memory, { pattern: "MiniGame", reason: "pattern_directory_collision", raisedAt: 5 });

    await persist(io, tmp.path, memory);
    const loaded = await load(io, tmp.path, "session-1");

    expect(loaded).toEqual(memory);
    await tmp.cleanup();
  });

  it("returns a fresh memory when the session file is missing", async () => {
    const tmp = await dir({ unsafeCleanup: true });
    const loaded = await load(io, tmp.path, "absent");
    expect(loaded).toEqual(createSessionMemory("absent", loaded.startedAt));
    expect(loaded.returnedWindows).toEqual([]);
    await tmp.cleanup();
  });

  it("recovers to a fresh memory when the session file is corrupt", async () => {
    const tmp = await dir({ unsafeCleanup: true });
    await fs.writeFile(sessionFilePath(tmp.path, "broken"), "{ not valid json", "utf-8");
    const loaded = await load(io, tmp.path, "broken");
    expect(loaded.sessionId).toBe("broken");
    expect(loaded.returnedWindows).toEqual([]);
    expect(loaded.spills).toEqual([]);
    await tmp.cleanup();
  });

  it("recovers to a fresh memory when the file is structurally invalid", async () => {
    const tmp = await dir({ unsafeCleanup: true });
    await fs.writeFile(sessionFilePath(tmp.path, "wrong"), JSON.stringify({ sessionId: "wrong", startedAt: "nope" }), "utf-8");
    const loaded = await load(io, tmp.path, "wrong");
    expect(loaded).toEqual(createSessionMemory("wrong", loaded.startedAt));
    await tmp.cleanup();
  });
});

describe("sessionMemory FIFO eviction", () => {
  it("caps returned windows at MAX_RETURNED_WINDOWS, evicting oldest first", () => {
    const windows = Array.from({ length: MAX_RETURNED_WINDOWS + 50 }, (_, i) => window("a.ts", i));
    const memory = recordReturnedWindows(createSessionMemory("s"), windows);

    expect(memory.returnedWindows).toHaveLength(MAX_RETURNED_WINDOWS);
    expect(memory.returnedWindows[0].startLine).toBe(50);
    expect(memory.returnedWindows.at(-1)!.startLine).toBe(MAX_RETURNED_WINDOWS + 49);
  });

  it("caps spills at MAX_SPILLS, evicting oldest first", () => {
    let memory = createSessionMemory("s");
    for (let i = 0; i < MAX_SPILLS + 10; i++) {
      memory = recordSpill(memory, spill(i));
    }

    expect(memory.spills).toHaveLength(MAX_SPILLS);
    expect(memory.spills[0].createdAt).toBe(10);
    expect(memory.spills.at(-1)!.createdAt).toBe(MAX_SPILLS + 9);
  });

  it("does not mutate the input memory", () => {
    const original = createSessionMemory("s");
    const next = recordReturnedWindows(original, [window("a.ts", 1)]);
    expect(original.returnedWindows).toEqual([]);
    expect(next).not.toBe(original);
  });
});
