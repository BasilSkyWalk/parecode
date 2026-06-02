import { describe, it, expect, vi } from "vitest";
import * as fc from "fast-check";
import { SearchEngine, planMerges, findRelatedSymbols, dedupWindows, SearchMatch, MatchOrReference } from "./search.js";
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
  sessionId: vi.fn().mockReturnValue("test-session"),
  sessionDataPath: vi.fn().mockReturnValue("/tmp"),
  registerTool: vi.fn(),
  dispatchSubagent: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  log: vi.fn(),
  recordStat: vi.fn(),
  exec: vi.fn(),
  resolveCommand: vi.fn().mockResolvedValue("/usr/bin/rg"),
  realpath: vi.fn().mockImplementation(async (p: string) => p),
  listDirs: vi.fn().mockResolvedValue([]),
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
    const match = (result.matches as SearchMatch[])![0];
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

    expect((result.matches as SearchMatch[])?.map((m) => m.file).sort()).toEqual(["a.ts", "b.ts"]);
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

    const expected = (result.matches as SearchMatch[])!.reduce(
      (sum, m) => sum + Math.ceil((m.content ?? "").length / 4),
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
    const match = (result.matches as SearchMatch[])![0];

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
    expect((result.matches as SearchMatch[])![0].file).toBe("a.ts");
  });

  describe("snapshot tests", () => {
    it("should match snapshot for chunked result with expected windows and omitted ranges", async () => {
      const filler = (n: number) => `Line ${n} content to take up space.\n`;
      const events: RgEvent[] = [];
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
        maxBytesPerFile: 250,
      });

      expect(result.status).toBe("success");
      expect(result.matches).toHaveLength(1);
      expect((result.matches as SearchMatch[])![0]).toMatchSnapshot();
    });
  });

  describe("v0.2: token estimates", () => {
    it("attaches a response-level estimatedTokens", async () => {
      const stdout = toRgJson([
        { type: "match", file: "a.ts", line: 1, text: "alpha\n" },
        { type: "match", file: "b.ts", line: 1, text: "beta\n" },
      ]);
      const host = makeHost({
        exec: vi.fn().mockResolvedValue({ stdout, stderr: "", code: 0 }),
      });
      const engine = new SearchEngine(host);

      const result = await engine.search({ pattern: "x" });

      expect(result.matches).toHaveLength(2);
      expect(result.estimatedTokens).toBeGreaterThan(0);
    });

    it("response-level estimatedTokens scales with envelope size", async () => {
      const small = toRgJson([{ type: "match", file: "a.ts", line: 1, text: "hi\n" }]);
      const manyEvents = Array.from({ length: 50 }, (_, i) => ({
        type: "match" as const,
        file: `dir/sub/long-name-${i}.ts`,
        line: i + 1,
        text: "hi\n",
      }));
      const big = toRgJson(manyEvents);
      const hostSmall = makeHost({ exec: vi.fn().mockResolvedValue({ stdout: small, stderr: "", code: 0 }) });
      const hostBig = makeHost({ exec: vi.fn().mockResolvedValue({ stdout: big, stderr: "", code: 0 }) });

      const r1 = await new SearchEngine(hostSmall).search({ pattern: "hi" });
      const r2 = await new SearchEngine(hostBig).search({ pattern: "hi" });
      expect(r2.estimatedTokens!).toBeGreaterThan(r1.estimatedTokens!);
    });
  });

  describe("v0.2: multi-pattern", () => {
    it("dispatches one ripgrep call per pattern in parallel", async () => {
      const exec = vi.fn().mockResolvedValue({ stdout: "", stderr: "", code: 1 });
      const host = makeHost({ exec });
      const engine = new SearchEngine(host);

      await engine.search({ pattern: ["foo", "bar", "baz"] });

      expect(exec).toHaveBeenCalledTimes(3);
      expect(exec).toHaveBeenCalledWith("/usr/bin/rg", ["--json", "-C", "2", "foo", "."]);
      expect(exec).toHaveBeenCalledWith("/usr/bin/rg", ["--json", "-C", "2", "bar", "."]);
      expect(exec).toHaveBeenCalledWith("/usr/bin/rg", ["--json", "-C", "2", "baz", "."]);
    });

    it("single-pattern call still tags each match with patterns: [theirPattern]", async () => {
      const stdout = toRgJson([{ type: "match", file: "a.ts", line: 1, text: "hi\n" }]);
      const host = makeHost({ exec: vi.fn().mockResolvedValue({ stdout, stderr: "", code: 0 }) });
      const engine = new SearchEngine(host);

      const result = await engine.search({ pattern: "needle" });
      expect((result.matches as SearchMatch[])![0].patterns).toEqual(["needle"]);
    });

    it("merges blocks from different patterns in the same file and unions their patterns lists", async () => {
      const exec = vi
        .fn()
        .mockResolvedValueOnce({
          stdout: toRgJson([{ type: "match", file: "x.ts", line: 5, text: "alpha\n" }]),
          stderr: "",
          code: 0,
        })
        .mockResolvedValueOnce({
          stdout: toRgJson([{ type: "match", file: "x.ts", line: 6, text: "beta\n" }]),
          stderr: "",
          code: 0,
        });
      const host = makeHost({ exec });
      const engine = new SearchEngine(host);

      const result = await engine.search({ pattern: ["alpha", "beta"] });
      expect(result.matches).toHaveLength(1);
      expect((result.matches as SearchMatch[])![0].patterns).toEqual(["alpha", "beta"]);
      expect((result.matches as SearchMatch[])![0].lineRanges).toEqual([[5, 6]]);
    });

    it("reports per-pattern failures in errors[] but keeps successful patterns", async () => {
      const exec = vi
        .fn()
        .mockResolvedValueOnce({
          stdout: toRgJson([{ type: "match", file: "a.ts", line: 1, text: "hit\n" }]),
          stderr: "",
          code: 0,
        })
        .mockResolvedValueOnce({ stdout: "", stderr: "bad regex", code: 2 });
      const host = makeHost({ exec });
      const engine = new SearchEngine(host);

      const result = await engine.search({ pattern: ["good", "bad("] });
      expect(result.status).toBe("success");
      expect(result.matches).toHaveLength(1);
      expect(result.errors).toEqual([{ pattern: "bad(", detail: "ripgrep exited with code 2" }]);
    });

    it("returns status: error when all patterns fail", async () => {
      const exec = vi.fn().mockResolvedValue({ stdout: "", stderr: "boom", code: 2 });
      const host = makeHost({ exec });
      const engine = new SearchEngine(host);

      const result = await engine.search({ pattern: ["a", "b"] });
      expect(result.status).toBe("error");
      expect(result.errors).toHaveLength(2);
    });

    it("throws on empty pattern array", async () => {
      const host = makeHost();
      const engine = new SearchEngine(host);
      await expect(engine.search({ pattern: [] })).rejects.toThrow(/non-empty/);
    });
  });

  describe("v0.2: dedup", () => {
    it("merges two windows with small gap by bridging via readFile", async () => {
      const exec = vi.fn().mockResolvedValue({
        stdout: toRgJson([
          { type: "match", file: "a.ts", line: 1, text: "L1\n" },
          { type: "match", file: "a.ts", line: 4, text: "L4\n" },
        ]),
        stderr: "",
        code: 0,
      });
      const readFile = vi.fn().mockResolvedValue("L1\nL2\nL3\nL4\nL5\n");
      const host = makeHost({ exec, readFile });
      const engine = new SearchEngine(host);

      const result = await engine.search({ pattern: "L" });
      expect(result.matches).toHaveLength(1);
      const m = (result.matches as SearchMatch[])![0];
      expect(m.lineRanges).toEqual([[1, 4]]);
      expect(m.content).toBe("L1\nL2\nL3\nL4\n");
    });

    it("falls back to unmerged windows when bridging read fails", async () => {
      const exec = vi.fn().mockResolvedValue({
        stdout: toRgJson([
          { type: "match", file: "a.ts", line: 1, text: "L1\n" },
          { type: "match", file: "a.ts", line: 4, text: "L4\n" },
        ]),
        stderr: "",
        code: 0,
      });
      const readFile = vi.fn().mockRejectedValue(new Error("nope"));
      const log = vi.fn();
      const host = makeHost({ exec, readFile, log });
      const engine = new SearchEngine(host);

      const result = await engine.search({ pattern: "L" });
      expect(result.matches).toHaveLength(1);
      expect((result.matches as SearchMatch[])![0].lineRanges).toEqual([[1, 1], [4, 4]]);
      expect(log).toHaveBeenCalledWith("warn", expect.stringContaining("bridge read failed"), expect.any(Object));
    });
  });

  describe("v0.2: planMerges", () => {
    it("merges overlapping windows", () => {
      const plan = planMerges([{ startLine: 1, endLine: 5 }, { startLine: 4, endLine: 8 }], 0);
      expect(plan.groups).toEqual([[0, 1]]);
    });

    it("keeps far-apart windows separate", () => {
      const plan = planMerges([{ startLine: 1, endLine: 3 }, { startLine: 100, endLine: 102 }], 2);
      expect(plan.groups).toEqual([[0], [1]]);
    });

    it("merges windows with gap <= contextLines", () => {
      const plan = planMerges([{ startLine: 1, endLine: 3 }, { startLine: 6, endLine: 8 }], 2);
      expect(plan.groups).toEqual([[0, 1]]);
    });

    it("is order-independent (property)", () => {
      fc.assert(
        fc.property(
          fc.array(
            fc
              .tuple(fc.nat({ max: 100 }), fc.nat({ max: 100 }))
              .map(([a, b]) => ({ startLine: Math.min(a, b) + 1, endLine: Math.max(a, b) + 1 })),
            { maxLength: 10 },
          ),
          fc.nat({ max: 5 }),
          (windows, ctx) => {
            const shuffled = [...windows].reverse();
            const p1 = planMerges(windows, ctx);
            const p2 = planMerges(shuffled, ctx);
            const norm = (
              p: { groups: number[][] },
              src: Array<{ startLine: number; endLine: number }>,
            ) =>
              p.groups
                .map((g) =>
                  g
                    .map((i) => `${src[i].startLine}-${src[i].endLine}`)
                    .sort()
                    .join(","),
                )
                .sort();
            expect(norm(p1, windows)).toEqual(norm(p2, shuffled));
          },
        ),
      );
    });

    it("is idempotent in terms of group count (property)", () => {
      fc.assert(
        fc.property(
          fc.array(
            fc
              .tuple(fc.nat({ max: 50 }), fc.nat({ max: 50 }))
              .map(([a, b]) => ({ startLine: Math.min(a, b) + 1, endLine: Math.max(a, b) + 1 })),
            { minLength: 1, maxLength: 8 },
          ),
          fc.nat({ max: 5 }),
          (windows, ctx) => {
            const plan = planMerges(windows, ctx);
            const collapsed = plan.groups.map((g) => {
              const s = Math.min(...g.map((i) => windows[i].startLine));
              const e = Math.max(...g.map((i) => windows[i].endLine));
              return { startLine: s, endLine: e };
            });
            const replan = planMerges(collapsed, ctx);
            expect(replan.groups.length).toBe(plan.groups.length);
          },
        ),
      );
    });
  });

  describe("v0.2: relatedSymbols", () => {
    it("attaches related symbols to matches that contain them", async () => {
      const stdout = toRgJson([
        { type: "match", file: "a.ts", line: 1, text: "HandlePlayerJoin();\n" },
        { type: "match", file: "a.ts", line: 2, text: "OnPlayerJoin();\n" },
      ]);
      const host = makeHost({ exec: vi.fn().mockResolvedValue({ stdout, stderr: "", code: 0 }) });
      const engine = new SearchEngine(host);

      const result = await engine.search({ pattern: "PlayerJoin", relatedSymbols: true });
      expect((result.matches as SearchMatch[])![0].relatedSymbols).toEqual(["HandlePlayerJoin", "OnPlayerJoin"]);
    });

    it("omits relatedSymbols field when opt-in is false", async () => {
      const stdout = toRgJson([{ type: "match", file: "a.ts", line: 1, text: "HandleFoo()\n" }]);
      const host = makeHost({ exec: vi.fn().mockResolvedValue({ stdout, stderr: "", code: 0 }) });
      const engine = new SearchEngine(host);

      const result = await engine.search({ pattern: "Foo" });
      expect((result.matches as SearchMatch[])![0].relatedSymbols).toBeUndefined();
    });

    it("skips short patterns (< 4 chars) when extracting source symbols", async () => {
      const stdout = toRgJson([{ type: "match", file: "a.ts", line: 1, text: "HandleX OnY ZHandler\n" }]);
      const host = makeHost({ exec: vi.fn().mockResolvedValue({ stdout, stderr: "", code: 0 }) });
      const engine = new SearchEngine(host);

      const result = await engine.search({ pattern: "X", relatedSymbols: true });
      expect((result.matches as SearchMatch[])![0].relatedSymbols).toEqual([]);
    });

    it("caps related symbols at 10 per match", () => {
      const content = Array.from({ length: 20 }, (_, i) => `On${"Sym" + i}Foo()`).join("\n");
      const out = findRelatedSymbols(content, ["FooBar"]);
      expect(out.length).toBeLessThanOrEqual(10);
    });
  });

  describe("v0.5: brief search", () => {
    it("omits content for matches whose own size exceeds INLINE_THRESHOLD (2KB)", async () => {
      const heavyLine = "x".repeat(2100) + "\n";
      const stdout = toRgJson([
        { type: "match", file: "a.ts", line: 1, text: heavyLine },
        { type: "match", file: "b.ts", line: 1, text: heavyLine },
        { type: "match", file: "c.ts", line: 1, text: heavyLine },
      ]);
      const host = makeHost({
        exec: vi.fn().mockResolvedValue({ stdout, stderr: "", code: 0 }),
      });
      const engine = new SearchEngine(host);

      const result = await engine.search({ pattern: "x" });

      expect(result.status).toBe("success");
      for (const m of (result.matches as SearchMatch[])!) {
        expect(m.content).toBeUndefined();
        expect(m.omittedLineRanges).toContainEqual([1, 1]);
      }
    });

    it("inlines small matches even when a sibling match is omitted", async () => {
      const heavyLine = "x".repeat(2100) + "\n";
      const stdout = toRgJson([
        { type: "match", file: "big.ts", line: 1, text: heavyLine },
        { type: "match", file: "small.ts", line: 1, text: "hit\n" },
      ]);
      const host = makeHost({
        exec: vi.fn().mockResolvedValue({ stdout, stderr: "", code: 0 }),
      });
      const engine = new SearchEngine(host);

      const result = await engine.search({ pattern: "x" });

      const big = (result.matches as SearchMatch[])!.find((m) => m.file === "big.ts")!;
      const small = (result.matches as SearchMatch[])!.find((m) => m.file === "small.ts")!;
      expect(big.content).toBeUndefined();
      expect(small.content).toBe("hit\n");
    });

    it("includes content when a match size is within INLINE_THRESHOLD", async () => {
      const stdout = toRgJson([{ type: "match", file: "a.ts", line: 1, text: "hit\n" }]);
      const host = makeHost({
        exec: vi.fn().mockResolvedValue({ stdout, stderr: "", code: 0 }),
      });
      const engine = new SearchEngine(host);

      const result = await engine.search({ pattern: "hit" });

      expect(result.status).toBe("success");
      expect((result.matches as SearchMatch[])![0].content).toBe("hit\n");
    });
  });

  describe("v0.3: summary pass", () => {
    it("omits summary when matches <= 10", async () => {
      const events: RgEvent[] = [];
      for (let i = 1; i <= 10; i++) {
        events.push({ type: "match", file: `f${i}.ts`, line: 1, text: `hit${i}\n` });
      }
      const host = makeHost({
        exec: vi.fn().mockResolvedValue({ stdout: toRgJson(events), stderr: "", code: 0 }),
      });
      const engine = new SearchEngine(host);
      const result = await engine.search({ pattern: "hit" });

      expect(result.matches).toHaveLength(10);
      expect(result.summary).toBeUndefined();
    });

    it("includes summary with top 10 matches by estimatedTokens when matches > 10", async () => {
      const events: RgEvent[] = [];
      for (let i = 1; i <= 12; i++) {
        events.push({ type: "match", file: `f${i}.ts`, line: 1, text: "x".repeat(i * 10) + "\n" });
      }
      const host = makeHost({
        exec: vi.fn().mockResolvedValue({ stdout: toRgJson(events), stderr: "", code: 0 }),
      });
      const engine = new SearchEngine(host);
      const result = await engine.search({ pattern: "x" });

      expect(result.matches).toHaveLength(12);
      expect(result.summary).toBeDefined();
      expect(result.summary).toHaveLength(10);
      expect(result.summary![0].file).toBe("f12.ts");
      expect(result.summary![9].file).toBe("f3.ts");
      expect(result.summary![0].estimatedTokens).toBeGreaterThan(result.summary![9].estimatedTokens);
    });
  });

  describe("v0.5: dedupWindows", () => {
    it("preserves non-overlapping matches", () => {
      const matches: SearchMatch[] = [
        { kind: "match", file: "/foo", hits: [], lineRanges: [[10, 20]], patterns: ["a"], content: "a" },
        { kind: "match", file: "/bar", hits: [], lineRanges: [[10, 20]], patterns: ["b"], content: "b" },
      ];
      const result = dedupWindows(matches, [], 2);
      expect(result).toEqual(matches);
    });

    it("emits a reference if a block is completely covered by a prior window", () => {
      const matches: SearchMatch[] = [
        { kind: "match", file: "a.ts", hits: [], lineRanges: [[5, 10]], patterns: ["x"], content: "lines5-10" }
      ];
      const history = [
        { file: "a.ts", startLine: 1, endLine: 20, returnedAt: 123, fromCallId: "abc" }
      ];
      const result = dedupWindows(matches, history, 2);
      expect(result).toEqual([{
        kind: "reference",
        file: "a.ts",
        lineRanges: [[5, 10]],
        returnedAt: 123,
        note: expect.stringContaining("Already returned")
      }]);
    });

    it("keeps a block if it only partially overlaps a prior window", () => {
      const matches: SearchMatch[] = [
        { kind: "match", file: "a.ts", hits: [], lineRanges: [[5, 10]], patterns: ["x"], content: "lines5-10" }
      ];
      const history = [
        { file: "a.ts", startLine: 1, endLine: 7, returnedAt: 123, fromCallId: "abc" }
      ];
      const result = dedupWindows(matches, history, 2);
      expect(result).toEqual(matches);
    });

    it("converts a full overlap (subset) to a reference", () => {
      const matches: SearchMatch[] = [
        { kind: "match", file: "/foo", hits: [], lineRanges: [[12, 18]], patterns: ["a"], content: "a" },
        { kind: "match", file: "/bar", hits: [], lineRanges: [[10, 20]], patterns: ["b"], content: "b" },
      ];
      const history = [
        { file: "a.ts", startLine: 1, endLine: 20, returnedAt: 123, fromCallId: "abc" }
      ];
      const result = dedupWindows(matches, history, 2);
      expect(result).toEqual(matches);
    });

    it("preserves ranges that do not overlap but replaces those that do within the same match", () => {
      const matches: SearchMatch[] = [
        {
          kind: "match",
          file: "/foo",
          hits: [],
          lineRanges: [
            [12, 15],
            [50, 60],
          ],
          patterns: ["a"],
          content: "content1\n---\n\ncontent2",
        },
      ];
      const history = [
        { file: "/foo", startLine: 1, endLine: 15, returnedAt: 123, fromCallId: "abc" }
      ];
      const result = dedupWindows(matches, history, 2);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        kind: "reference",
        file: "/foo",
        lineRanges: [[12, 15]],
        returnedAt: 123,
        note: expect.stringContaining("Already returned")
      });
      expect(result[1]).toEqual({
        kind: "match",
        file: "/foo",
        hits: [],
        lineRanges: [[50, 60]],
        patterns: ["a"],
        content: "content2"
      });
    });
    
    it("handles omitted content correctly when splitting blocks", () => {
      const matches: SearchMatch[] = [
        {
          kind: "match",
          file: "a.ts",
          hits: [],
          lineRanges: [[5, 10], [20, 25]] as Array<[number, number]>,
          patterns: ["x"],
        }
      ];
      const history = [
        { file: "a.ts", startLine: 1, endLine: 15, returnedAt: 123, fromCallId: "abc" }
      ];
      const result = dedupWindows(matches, history, 2);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        kind: "reference",
        file: "a.ts",
        lineRanges: [[5, 10]],
        returnedAt: 123,
        note: expect.stringContaining("Already returned")
      });
      expect(result[1].lineRanges).toEqual([[20, 25]]);
      expect((result[1] as SearchMatch).content).toBeUndefined();
    });

    it("is idempotent for match results (property)", () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.tuple(fc.nat({ max: 50 }), fc.nat({ max: 50 })).map(([a, b]) => {
              const start = Math.min(a, b) + 1;
              const end = Math.max(a, b) + 1;
              return {
                kind: "match" as const,
                file: "/file.ts",
                lineRanges: [[start, end]] as Array<[number, number]>,
                patterns: ["x"],
                hits: [],
              };
            }),
            { maxLength: 5 },
          ),
          fc.array(
            fc.tuple(fc.nat({ max: 50 }), fc.nat({ max: 50 })).map(([a, b]) => {
              const start = Math.min(a, b) + 1;
              const end = Math.max(a, b) + 1;
              return { file: "/file.ts", startLine: start, endLine: end, returnedAt: 123, fromCallId: "abc" };
            }),
            { maxLength: 5 },
          ),
          fc.nat({ max: 5 }),
          (matches, history, ctx) => {
            const pass1 = dedupWindows(matches, history, ctx);
            const matchesOnly = pass1.filter((m) => m.kind === "match") as SearchMatch[];
            const pass2 = dedupWindows(matchesOnly, history, ctx);
            expect(pass2).toEqual(matchesOnly);
          },
        ),
      );
    });

    it("is order-independent (property)", () => {
      fc.assert(
        fc.property(
          fc.array(fc.tuple(fc.nat({ max: 50 }), fc.nat({ max: 50 })), { maxLength: 5 }).map((tuples) =>
            tuples.map(([a, b], i) => {
              const start = Math.min(a, b) + 1;
              const end = Math.max(a, b) + 1;
              return {
                kind: "match" as const,
                file: `/file${i}.ts`,
                lineRanges: [[start, end]] as Array<[number, number]>,
                patterns: ["x"],
                hits: [],
              };
            }),
          ),
          fc.array(fc.tuple(fc.nat({ max: 50 }), fc.nat({ max: 50 })), { maxLength: 5 }).map((tuples) =>
            tuples.map(([a, b]) => {
              const start = Math.min(a, b) + 1;
              const end = Math.max(a, b) + 1;
              return { file: `/file${a % 5}.ts`, startLine: start, endLine: end, returnedAt: 123, fromCallId: "abc" };
            }),
          ),
          fc.nat({ max: 5 }),
          (matches, history, ctx) => {
            const shuffled = [...matches].reverse();
            const pass1 = dedupWindows(matches, history, ctx);
            const pass2 = dedupWindows(shuffled, history, ctx);

            const sortKey = (m: MatchOrReference) => `${m.file}:${m.kind}:${m.lineRanges[0][0]}`;
            const sortMatches = (arr: MatchOrReference[]) => [...arr].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));

            expect(sortMatches(pass1)).toEqual(sortMatches(pass2));
          },
        ),
      );
    });
  });

  describe("spill", () => {
    const manyFiles = (count: number, bytesPerFile: number): string => {
      const events: RgEvent[] = [];
      for (let f = 0; f < count; f++) {
        events.push({ type: "match", file: `file${f}.ts`, line: 1, text: "x".repeat(bytesPerFile) + "\n" });
      }
      return toRgJson(events);
    };

    it("spills to a file and records it in session memory when over the token threshold", async () => {
      const writeFile = vi.fn().mockResolvedValue(undefined);
      const log = vi.fn();
      const host = makeHost({
        exec: vi.fn().mockResolvedValue({ stdout: manyFiles(80, 1500), stderr: "", code: 0 }),
        writeFile,
        log,
      });
      const engine = new SearchEngine(host);

      const result = await engine.search({ pattern: "x" });

      expect(result.status).toBe("spilled");
      expect(result.matches).toBeUndefined();
      expect(result.estimatedTokens).toBeGreaterThan(20000);
      expect(result.spillPath).toMatch(/^\/tmp\/parecode-spill-test-session-\d+\.json$/);
      expect(result.instructions).toContain(result.spillPath!);
      expect(result.summary).toHaveLength(10);

      const spillWrite = writeFile.mock.calls.find((c) => String(c[0]) === result.spillPath);
      expect(spillWrite).toBeDefined();
      const payload = JSON.parse(spillWrite![1]);
      expect(payload.status).toBe("success");
      expect(payload.matches).toHaveLength(80);

      const sessionWrite = writeFile.mock.calls.find((c) => String(c[0]) === "/tmp/test-session.json");
      expect(sessionWrite).toBeDefined();
      const memory = JSON.parse(sessionWrite![1]);
      expect(memory.spills).toHaveLength(1);
      expect(memory.spills[0]).toMatchObject({ path: result.spillPath, consumed: false });
      expect(memory.spills[0].fromCallId).toContain("test-session");

      expect(log).toHaveBeenCalledWith("info", "search result spilled to file", expect.objectContaining({ spillPath: result.spillPath }));
    });

    it("returns a summary sorted by estimatedTokens descending", async () => {
      const events: RgEvent[] = [];
      for (let f = 0; f < 80; f++) {
        events.push({ type: "match", file: `file${f}.ts`, line: 1, text: "x".repeat(500 + f * 15) + "\n" });
      }
      const host = makeHost({
        exec: vi.fn().mockResolvedValue({ stdout: toRgJson(events), stderr: "", code: 0 }),
        writeFile: vi.fn().mockResolvedValue(undefined),
      });
      const engine = new SearchEngine(host);

      const result = await engine.search({ pattern: "x" });

      expect(result.status).toBe("spilled");
      const tokens = result.summary!.map((s) => s.estimatedTokens);
      expect(tokens).toEqual([...tokens].sort((a, b) => b - a));
    });

    it("does not spill or write files when under the token threshold", async () => {
      const writeFile = vi.fn().mockResolvedValue(undefined);
      const host = makeHost({
        exec: vi.fn().mockResolvedValue({ stdout: manyFiles(3, 200), stderr: "", code: 0 }),
        writeFile,
      });
      const engine = new SearchEngine(host);

      const result = await engine.search({ pattern: "x" });

      expect(result.status).toBe("success");
      expect(result.matches).toBeDefined();
      expect(result.spillPath).toBeUndefined();
      const spillWrites = writeFile.mock.calls.filter((c) => String(c[0]).includes("spill"));
      expect(spillWrites).toHaveLength(0);
    });
  });

  describe("integration: real tmp-dir session memory", () => {
    it("two consecutive searches collapse overlap to references", async () => {
      const { dir } = await import("tmp-promise");
      const fs = await import("node:fs/promises");
      const tmp = await dir({ unsafeCleanup: true });

      const stdout1 = toRgJson([
        { type: "match", file: "/real/a.ts", line: 5, text: "hit1\n" },
        { type: "match", file: "/real/a.ts", line: 6, text: "hit2\n" },
      ]);
      const stdout2 = toRgJson([
        { type: "match", file: "/real/a.ts", line: 5, text: "hit1\n" },
        { type: "match", file: "/real/b.ts", line: 10, text: "hit3\n" },
      ]);

      const exec = vi.fn()
        .mockResolvedValueOnce({ stdout: stdout1, stderr: "", code: 0 })
        .mockResolvedValueOnce({ stdout: stdout2, stderr: "", code: 0 });

      const host = makeHost({
        sessionDataPath: vi.fn().mockReturnValue(tmp.path),
        exec,
        readFile: async (p) => fs.readFile(p, "utf-8"),
        writeFile: async (p, c) => fs.writeFile(p, c, "utf-8"),
      });

      const engine = new SearchEngine(host);

      const res1 = await engine.search({ pattern: "hit" });
      expect(res1.status).toBe("success");
      expect(res1.matches).toHaveLength(1);
      expect((res1.matches as SearchMatch[])![0].kind).toBe("match");

      const res2 = await engine.search({ pattern: "hit" });
      expect(res2.status).toBe("success");
      expect(res2.matches).toHaveLength(2);

      const ref = res2.matches!.find((m) => m.file === "/real/a.ts");
      expect(ref).toBeDefined();
      expect(ref!.kind).toBe("reference");

      const match = res2.matches!.find((m) => m.file === "/real/b.ts");
      expect(match).toBeDefined();
      expect(match!.kind).toBe("match");

      await tmp.cleanup();
    });
  });
});
