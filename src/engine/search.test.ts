import { describe, it, expect, vi } from "vitest";
import * as fc from "fast-check";
import { SearchEngine, planMerges, findRelatedSymbols } from "./search.js";
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
  dispatchSubagent: vi.fn(),
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
      expect(result.matches![0]).toMatchSnapshot();
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
      expect(result.matches![0].patterns).toEqual(["needle"]);
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
      expect(result.matches![0].patterns).toEqual(["alpha", "beta"]);
      expect(result.matches![0].lineRanges).toEqual([[5, 6]]);
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
      const m = result.matches![0];
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
      expect(result.matches![0].lineRanges).toEqual([[1, 1], [4, 4]]);
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
      expect(result.matches![0].relatedSymbols).toEqual(["HandlePlayerJoin", "OnPlayerJoin"]);
    });

    it("omits relatedSymbols field when opt-in is false", async () => {
      const stdout = toRgJson([{ type: "match", file: "a.ts", line: 1, text: "HandleFoo()\n" }]);
      const host = makeHost({ exec: vi.fn().mockResolvedValue({ stdout, stderr: "", code: 0 }) });
      const engine = new SearchEngine(host);

      const result = await engine.search({ pattern: "Foo" });
      expect(result.matches![0].relatedSymbols).toBeUndefined();
    });

    it("skips short patterns (< 4 chars) when extracting source symbols", async () => {
      const stdout = toRgJson([{ type: "match", file: "a.ts", line: 1, text: "HandleX OnY ZHandler\n" }]);
      const host = makeHost({ exec: vi.fn().mockResolvedValue({ stdout, stderr: "", code: 0 }) });
      const engine = new SearchEngine(host);

      const result = await engine.search({ pattern: "X", relatedSymbols: true });
      expect(result.matches![0].relatedSymbols).toEqual([]);
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
      for (const m of result.matches!) {
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

      const big = result.matches!.find((m) => m.file === "big.ts")!;
      const small = result.matches!.find((m) => m.file === "small.ts")!;
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
      expect(result.matches![0].content).toBe("hit\n");
    });
  });
});
