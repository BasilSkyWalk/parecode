import { describe, it, expect, vi } from "vitest";
import { ExpandEngine } from "./expand.js";
import { ToolHost } from "../adapters/base.js";

const makeHost = (overrides: Partial<ToolHost> = {}): ToolHost => ({
  registerTool: vi.fn(),
  dispatchSubagent: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  log: vi.fn(),
  recordStat: vi.fn(),
  exec: vi.fn(),
  resolveCommand: vi.fn(),
  statFile: vi.fn(),
  ...overrides,
});

describe("ExpandEngine", () => {
  it("returns the requested inclusive slice with a 1-based lineRange", async () => {
    const host = makeHost({ readFile: vi.fn().mockResolvedValue("a\nb\nc\nd\ne\n") });
    const engine = new ExpandEngine(host);

    const r = await engine.expand({ file: "f", startLine: 2, endLine: 4 });
    expect(r.status).toBe("success");
    expect(r.lineRange).toEqual([2, 4]);
    expect(r.content).toBe("b\nc\nd\n");
    expect(r.estimatedTokens).toBe(Math.ceil(r.content!.length / 4));
  });

  it("applies contextBefore and contextAfter padding", async () => {
    const host = makeHost({ readFile: vi.fn().mockResolvedValue("a\nb\nc\nd\ne\n") });
    const engine = new ExpandEngine(host);

    const r = await engine.expand({
      file: "f",
      startLine: 3,
      endLine: 3,
      contextBefore: 1,
      contextAfter: 1,
    });
    expect(r.lineRange).toEqual([2, 4]);
    expect(r.content).toBe("b\nc\nd\n");
  });

  it("clamps silently to file bounds", async () => {
    const host = makeHost({ readFile: vi.fn().mockResolvedValue("a\nb\nc\n") });
    const engine = new ExpandEngine(host);

    const r = await engine.expand({
      file: "f",
      startLine: 1,
      endLine: 100,
      contextBefore: 10,
      contextAfter: 10,
    });
    expect(r.lineRange).toEqual([1, 3]);
    expect(r.content).toBe("a\nb\nc\n");
  });

  it("returns file_not_found for ENOENT", async () => {
    const err: NodeJS.ErrnoException = Object.assign(new Error("nope"), { code: "ENOENT" });
    const host = makeHost({ readFile: vi.fn().mockRejectedValue(err) });
    const engine = new ExpandEngine(host);

    const r = await engine.expand({ file: "missing", startLine: 1, endLine: 2 });
    expect(r.status).toBe("error");
    expect(r.detail).toBe("file_not_found");
  });

  it("returns read_failed for other read errors", async () => {
    const host = makeHost({ readFile: vi.fn().mockRejectedValue(new Error("EACCES")) });
    const engine = new ExpandEngine(host);

    const r = await engine.expand({ file: "f", startLine: 1, endLine: 2 });
    expect(r.status).toBe("error");
    expect(r.detail).toBe("read_failed");
  });

  it("returns empty_range for an empty file", async () => {
    const host = makeHost({ readFile: vi.fn().mockResolvedValue("") });
    const engine = new ExpandEngine(host);

    const r = await engine.expand({ file: "f", startLine: 1, endLine: 5 });
    expect(r.status).toBe("error");
    expect(r.detail).toBe("empty_range");
  });

  it("throws on endLine < startLine (invariant)", async () => {
    const host = makeHost();
    const engine = new ExpandEngine(host);
    await expect(engine.expand({ file: "f", startLine: 5, endLine: 2 })).rejects.toThrow();
  });

  it("throws on non-integer line numbers (invariant)", async () => {
    const host = makeHost();
    const engine = new ExpandEngine(host);
    await expect(engine.expand({ file: "f", startLine: 1.5, endLine: 2 })).rejects.toThrow();
  });
});
