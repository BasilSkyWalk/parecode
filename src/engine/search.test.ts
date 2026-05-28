import { describe, it, expect, vi } from "vitest";
import { SearchEngine } from "./search.js";
import { ToolHost } from "../adapters/base.js";

interface RgEvent {
  type: "match" | "context";
  file: string;
  line: number;
  text: string;
}

const toRgJson = (events: RgEvent[]): string =>
  events
    .map((e) =>
      JSON.stringify({
        type: e.type,
        data: {
          path: { text: e.file },
          line_number: e.line,
          lines: { text: e.text },
        },
      }),
    )
    .join("\n");

const makeHost = (overrides: Partial<ToolHost> = {}): ToolHost => ({
  registerTool: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  log: vi.fn(),
  recordStat: vi.fn(),
  exec: vi.fn(),
  resolveCommand: vi.fn().mockResolvedValue("/usr/bin/rg"),
  statFile: vi.fn(),
  ...overrides,
});

describe("SearchEngine", () => {
  it("returns error when ripgrep is not on PATH", async () => {
    const host = makeHost({ resolveCommand: vi.fn().mockResolvedValue(null) });
    const engine = new SearchEngine(host);

    const result = await engine.search({ pattern: "foo" });

    expect(result.status).toBe("error");
    expect(result.detail).toContain("ripgrep not found");
    expect(host.exec).not.toHaveBeenCalled();
  });

  it("treats ripgrep exit code 1 with empty stdout as no matches", async () => {
    const host = makeHost({
      exec: vi.fn().mockResolvedValue({ stdout: "", stderr: "", code: 1 }),
    });
    const engine = new SearchEngine(host);

    const result = await engine.search({ pattern: "foo" });

    expect(result.status).toBe("success");
    expect(result.matches).toEqual([]);
  });

  it("returns error on other non-zero exit codes", async () => {
    const host = makeHost({
      exec: vi.fn().mockResolvedValue({ stdout: "", stderr: "boom", code: 2 }),
    });
    const engine = new SearchEngine(host);

    const result = await engine.search({ pattern: "foo" });

    expect(result.status).toBe("error");
    expect(result.detail).toContain("code 2");
  });

  it("passes default contextLines=2 and cwd path '.' to ripgrep", async () => {
    const exec = vi.fn().mockResolvedValue({ stdout: "", stderr: "", code: 1 });
    const host = makeHost({ exec });
    const engine = new SearchEngine(host);

    await engine.search({ pattern: "foo" });

    expect(exec).toHaveBeenCalledWith(
      "/usr/bin/rg",
      ["--json", "-C", "2", "foo", "."],
    );
  });

  it("honors custom contextLines and explicit paths", async () => {
    const exec = vi.fn().mockResolvedValue({ stdout: "", stderr: "", code: 1 });
    const host = makeHost({ exec });
    const engine = new SearchEngine(host);

    await engine.search({
      pattern: "needle",
      paths: ["src", "lib"],
      contextLines: 5,
    });

    expect(exec).toHaveBeenCalledWith(
      "/usr/bin/rg",
      ["--json", "-C", "5", "needle", "src", "lib"],
    );
  });

  it("groups contiguous lines into a single range and joins gapped runs with a separator", async () => {
    const stdout = toRgJson([
      { type: "context", file: "a.ts", line: 1, text: "line1\n" },
      { type: "match", file: "a.ts", line: 2, text: "needle\n" },
      { type: "context", file: "a.ts", line: 3, text: "line3\n" },
      { type: "context", file: "a.ts", line: 10, text: "line10\n" },
      { type: "match", file: "a.ts", line: 11, text: "needle2\n" },
    ]);
    const host = makeHost({
      exec: vi.fn().mockResolvedValue({ stdout, stderr: "", code: 0 }),
    });
    const engine = new SearchEngine(host);

    const result = await engine.search({ pattern: "needle" });

    expect(result.status).toBe("success");
    expect(result.matches).toHaveLength(1);
    const match = result.matches![0];
    expect(match.file).toBe("a.ts");
    expect(match.lineRanges).toEqual([
      [1, 3],
      [10, 11],
    ]);
    expect(match.content).toBe("line1\nneedle\nline3\n\n---\n\nline10\nneedle2\n");
    expect(match.omittedLineRanges).toBeUndefined();
  });

  it("returns one entry per matched file", async () => {
    const stdout = toRgJson([
      { type: "match", file: "a.ts", line: 5, text: "alpha\n" },
      { type: "match", file: "b.ts", line: 9, text: "beta\n" },
    ]);
    const host = makeHost({
      exec: vi.fn().mockResolvedValue({ stdout, stderr: "", code: 0 }),
    });
    const engine = new SearchEngine(host);

    const result = await engine.search({ pattern: "x" });

    expect(result.matches?.map((m) => m.file).sort()).toEqual(["a.ts", "b.ts"]);
  });

  it("records actualTokens equal to ceil(total content length / 4)", async () => {
    const stdout = toRgJson([
      { type: "match", file: "a.ts", line: 1, text: "abcd\n" },
      { type: "match", file: "b.ts", line: 1, text: "efghij\n" },
    ]);
    const recordStat = vi.fn();
    const host = makeHost({
      exec: vi.fn().mockResolvedValue({ stdout, stderr: "", code: 0 }),
      recordStat,
    });
    const engine = new SearchEngine(host);

    const result = await engine.search({ pattern: "x" });

    const expected = result.matches!.reduce(
      (sum, m) => sum + Math.ceil(m.content.length / 4),
      0,
    );

    expect(recordStat).toHaveBeenCalledWith(
      expect.objectContaining({
        toolCall: "ParecodeSearch",
        truncate: "v1-text",
        filesMatched: 2,
        actualTokens: expected,
      }),
    );
  });

  it("chunks around match centers when maxBytesPerFile is exceeded and reports omitted ranges", async () => {
    const filler = (n: number) => "x".repeat(40) + `_${n}\n`;
    const events: RgEvent[] = [];
    for (let line = 1; line <= 20; line++) {
      events.push({
        type: line === 10 ? "match" : "context",
        file: "big.ts",
        line,
        text: filler(line),
      });
    }
    const stdout = toRgJson(events);
    const host = makeHost({
      exec: vi.fn().mockResolvedValue({ stdout, stderr: "", code: 0 }),
    });
    const engine = new SearchEngine(host);

    const result = await engine.search({
      pattern: "x",
      maxBytesPerFile: 200,
    });

    expect(result.status).toBe("success");
    const match = result.matches![0];

    const included = new Set<number>();
    let cursor = match.lineRanges[0][0];
    for (const [start, end] of match.lineRanges) {
      for (let l = start; l <= end; l++) included.add(l);
      cursor = end;
    }
    expect(cursor).toBeGreaterThan(0);

    expect(included.has(10)).toBe(true);
    expect(included.size).toBeLessThan(20);

    const includedBytes = Array.from(included).reduce(
      (b, l) => b + Buffer.byteLength(filler(l), "utf8"),
      0,
    );
    expect(includedBytes).toBeLessThanOrEqual(200);

    expect(match.omittedLineRanges).toBeDefined();
    const omitted = new Set<number>();
    for (const [start, end] of match.omittedLineRanges!) {
      for (let l = start; l <= end; l++) omitted.add(l);
    }
    expect(omitted.size).toBeGreaterThan(0);
    for (const l of omitted) expect(included.has(l)).toBe(false);
    expect(omitted.size + included.size).toBe(20);
  });

  it("ignores malformed ripgrep JSON lines without throwing", async () => {
    const goodLine = toRgJson([
      { type: "match", file: "a.ts", line: 1, text: "hit\n" },
    ]);
    const stdout = `not-json\n${goodLine}\n{"type":"summary"}`;
    const host = makeHost({
      exec: vi.fn().mockResolvedValue({ stdout, stderr: "", code: 0 }),
    });
    const engine = new SearchEngine(host);

    const result = await engine.search({ pattern: "hit" });

    expect(result.status).toBe("success");
    expect(result.matches).toHaveLength(1);
    expect(result.matches![0].file).toBe("a.ts");
  });

  describe("snapshot tests", () => {
    it("should match snapshot for chunked result with expected windows and omitted ranges", async () => {
      const filler = (n: number) => `Line ${n} content to take up space.\n`;
      const events: RgEvent[] = [];
      // 30 lines total. Matches on line 10 and 20.
      for (let line = 1; line <= 30; line++) {
        events.push({
          type: line === 10 || line === 20 ? "match" : "context",
          file: "large.ts",
          line,
          text: filler(line),
        });
      }
      const stdout = toRgJson(events);
      const host = makeHost({
        exec: vi.fn().mockResolvedValue({ stdout, stderr: "", code: 0 }),
      });
      const engine = new SearchEngine(host);

      const result = await engine.search({
        pattern: "take",
        maxBytesPerFile: 250, // Force chunking. ~8 lines total (250 / 32)
      });

      expect(result.status).toBe("success");
      expect(result.matches).toHaveLength(1);
      expect(result.matches![0]).toMatchSnapshot();
    });
  });
});
