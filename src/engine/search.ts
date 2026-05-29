import { ToolHost } from "../adapters/base.js";
import { estimateTokens, estimateSearchEnvelopeTokens } from "../stats/estimator.js";

export interface SearchArgs {
  pattern: string | string[];
  paths?: string[];
  contextLines?: number;
  maxBytesPerFile?: number;
  relatedSymbols?: boolean;
}

export interface SearchMatch {
  file: string;
  content: string;
  lineRanges: Array<[number, number]>;
  omittedLineRanges?: Array<[number, number]>;
  omittedLines?: number;
  patterns: string[];
  estimatedTokens: number;
  relatedSymbols?: string[];
}

const OMITTED_RANGES_INLINE_CAP = 8;

export interface SearchResult {
  status: "success" | "error";
  detail?: string;
  matches?: SearchMatch[];
  errors?: Array<{ pattern: string; detail: string }>;
  estimatedTokens?: number;
  recommendation?: string;
}

interface SearchWindow {
  startLine: number;
  endLine: number;
  content: string;
  patterns: Set<string>;
}

interface FileResult {
  file: string;
  windows: SearchWindow[];
  omittedLineRanges?: Array<[number, number]>;
}

interface PatternRunResult {
  files: Map<string, FileResult>;
  error?: string;
}

export interface MergePlan {
  groups: number[][];
}

const LARGE_RESULT_TOKEN_THRESHOLD = 4000;
const RELATED_SYMBOL_CAP = 10;
const MIN_SYMBOL_LENGTH = 4;

export class SearchEngine {
  constructor(private host: ToolHost) {}

  public async search(args: SearchArgs): Promise<SearchResult> {
    const rgPath = await this.host.resolveCommand("rg");
    if (!rgPath) {
      this.host.log("error", "ripgrep not found via which");
      return {
        status: "error",
        detail: "ripgrep not found on PATH. Please install it or run 'parecode doctor' for more information.",
      };
    }

    const patterns = normalizePatterns(args.pattern);
    const ctx = args.contextLines ?? 2;
    const paths = args.paths && args.paths.length > 0 ? args.paths : ["."];

    const runs = await Promise.all(
      patterns.map((p) => this.runPattern(rgPath, p, paths, ctx, args.maxBytesPerFile)),
    );

    const errors: Array<{ pattern: string; detail: string }> = [];
    const perFile = new Map<string, FileResult>();

    for (let i = 0; i < patterns.length; i++) {
      const run = runs[i];
      const pattern = patterns[i];
      if (run.error) {
        errors.push({ pattern, detail: run.error });
        continue;
      }
      for (const [file, fr] of run.files) {
        const existing = perFile.get(file);
        if (!existing) {
          perFile.set(file, {
            file,
            windows: fr.windows.map((w) => ({ ...w, patterns: new Set(w.patterns) })),
            omittedLineRanges: fr.omittedLineRanges ? [...fr.omittedLineRanges] : undefined,
          });
        } else {
          existing.windows.push(
            ...fr.windows.map((w) => ({ ...w, patterns: new Set(w.patterns) })),
          );
          if (fr.omittedLineRanges) {
            existing.omittedLineRanges = mergeRanges(existing.omittedLineRanges, fr.omittedLineRanges);
          }
        }
      }
    }

    if (patterns.length > 0 && errors.length === patterns.length) {
      return {
        status: "error",
        detail: errors.map((e) => `[${e.pattern}] ${e.detail}`).join("; "),
        errors,
      };
    }

    const sourceSymbols = args.relatedSymbols ? extractSourceSymbols(patterns) : [];

    const matches: SearchMatch[] = [];
    for (const fr of perFile.values()) {
      fr.windows.sort((a, b) => a.startLine - b.startLine);
      const plan = planMerges(fr.windows, ctx);
      const mergedWindows = await this.executeMerges(fr.file, fr.windows, plan);

      const lineRanges: Array<[number, number]> = mergedWindows.map((w) => [w.startLine, w.endLine]);
      const content = mergedWindows.map((w) => w.content).join("\n---\n\n");
      const patternsList = Array.from(
        new Set(mergedWindows.flatMap((w) => Array.from(w.patterns))),
      ).sort();

      const omitted = fr.omittedLineRanges;
      const omittedLines = omitted
        ? omitted.reduce((sum, [s, e]) => sum + (e - s + 1), 0)
        : 0;
      const includeRanges = omitted && omitted.length > 0 && omitted.length <= OMITTED_RANGES_INLINE_CAP;

      const match: SearchMatch = {
        file: fr.file,
        content,
        lineRanges,
        patterns: patternsList,
        estimatedTokens: estimateTokens(content),
        ...(includeRanges ? { omittedLineRanges: omitted } : {}),
        ...(omittedLines > 0 ? { omittedLines } : {}),
      };

      if (args.relatedSymbols) {
        match.relatedSymbols = findRelatedSymbols(content, sourceSymbols);
      }

      matches.push(match);
    }

    let estimatedNativeTokens = 0;
    await Promise.all(
      matches.map(async (m) => {
        try {
          const s = await this.host.statFile(m.file);
          estimatedNativeTokens += Math.ceil(s.size / 4);
        } catch {}
      }),
    );

    const estimatedTokensTotal = estimateSearchEnvelopeTokens(matches, errors);

    const actualTokens = matches.reduce((s, m) => s + m.estimatedTokens, 0);

    this.host.recordStat({
      toolCall: "ParecodeSearch",
      pattern: patterns.join("|"),
      truncate: "v1-text",
      filesMatched: matches.length,
      estimatedNativeTokens,
      actualTokens,
      callsBatched: matches.length,
    });

    const isLargeResult = actualTokens > LARGE_RESULT_TOKEN_THRESHOLD;
    const recommendation = isLargeResult
      ? "Result is large. Consider narrowing 'paths', tightening the pattern, or dispatching a Haiku Task subagent to extract just the relevant section before consuming the full content."
      : undefined;

    return {
      status: "success",
      matches,
      ...(errors.length > 0 ? { errors } : {}),
      estimatedTokens: estimatedTokensTotal,
      ...(recommendation ? { recommendation } : {}),
    };
  }

  private async runPattern(
    rgPath: string,
    pattern: string,
    paths: string[],
    ctx: number,
    maxBytesPerFile: number | undefined,
  ): Promise<PatternRunResult> {
    const rgArgs = ["--json", "-C", ctx.toString(), pattern, ...paths];
    this.host.log("info", "Spawning ripgrep", { rgArgs });

    const { stdout, code, stderr } = await this.host.exec(rgPath, rgArgs);

    if (code !== 0 && stdout.trim() === "") {
      if (code === 1) return { files: new Map() };
      this.host.log("error", "ripgrep failed", { code, stderr, pattern });
      return { files: new Map(), error: `ripgrep exited with code ${code}` };
    }

    const lines = stdout.split("\n").filter(Boolean);
    const fileMatches = new Map<string, { linesMap: Map<number, string>; matchLines: Set<number> }>();

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        if (parsed.type === "match" || parsed.type === "context") {
          const file = parsed.data.path.text;
          const lineNum = parsed.data.line_number;
          const text = parsed.data.lines.text;
          if (!fileMatches.has(file)) {
            fileMatches.set(file, { linesMap: new Map(), matchLines: new Set() });
          }
          fileMatches.get(file)!.linesMap.set(lineNum, text);
          if (parsed.type === "match") {
            fileMatches.get(file)!.matchLines.add(lineNum);
          }
        }
      } catch {}
    }

    const files = new Map<string, FileResult>();
    for (const [file, data] of fileMatches) {
      const fr = buildFileResult(file, data, maxBytesPerFile, pattern);
      if (fr) files.set(file, fr);
    }
    return { files };
  }

  private async executeMerges(
    file: string,
    windows: SearchWindow[],
    plan: MergePlan,
  ): Promise<SearchWindow[]> {
    if (plan.groups.length === 0) return [];

    let cachedLines: string[] | null = null;
    const loadFileLines = async (): Promise<string[]> => {
      if (cachedLines !== null) return cachedLines;
      const raw = await this.host.readFile(file);
      cachedLines = splitFileLines(raw);
      return cachedLines;
    };

    const result: SearchWindow[] = [];
    for (const group of plan.groups) {
      if (group.length === 1) {
        result.push(windows[group[0]]);
        continue;
      }
      try {
        const merged = await mergeWindowGroup(group, windows, loadFileLines);
        result.push(merged);
      } catch (e) {
        this.host.log("warn", "dedup bridge read failed; emitting unmerged windows", {
          file,
          error: String(e),
        });
        for (const idx of group) result.push(windows[idx]);
      }
    }
    return result;
  }
}

function normalizePatterns(p: string | string[]): string[] {
  if (typeof p === "string") return [p];
  if (!Array.isArray(p) || p.length === 0) {
    throw new Error("pattern must be a non-empty string or string[]");
  }
  return p;
}

function buildFileResult(
  file: string,
  data: { linesMap: Map<number, string>; matchLines: Set<number> },
  maxBytesPerFile: number | undefined,
  pattern: string,
): FileResult | null {
  const allLineNumbers = Array.from(data.linesMap.keys()).sort((a, b) => a - b);
  if (allLineNumbers.length === 0) return null;

  let totalBytes = 0;
  for (const text of data.linesMap.values()) {
    totalBytes += Buffer.byteLength(text, "utf8");
  }

  let includedLines = new Set(allLineNumbers);

  if (maxBytesPerFile && totalBytes > maxBytesPerFile) {
    includedLines = new Set<number>();
    let currentBytes = 0;
    for (const matchLine of data.matchLines) {
      const text = data.linesMap.get(matchLine)!;
      const len = Buffer.byteLength(text, "utf8");
      if (currentBytes + len <= maxBytesPerFile) {
        includedLines.add(matchLine);
        currentBytes += len;
      }
    }
    let expanded = true;
    let distance = 1;
    while (expanded) {
      expanded = false;
      for (const matchLine of data.matchLines) {
        const prevLine = matchLine - distance;
        if (data.linesMap.has(prevLine) && !includedLines.has(prevLine)) {
          const t = data.linesMap.get(prevLine)!;
          const l = Buffer.byteLength(t, "utf8");
          if (currentBytes + l <= maxBytesPerFile) {
            includedLines.add(prevLine);
            currentBytes += l;
            expanded = true;
          }
        }
        const nextLine = matchLine + distance;
        if (data.linesMap.has(nextLine) && !includedLines.has(nextLine)) {
          const t = data.linesMap.get(nextLine)!;
          const l = Buffer.byteLength(t, "utf8");
          if (currentBytes + l <= maxBytesPerFile) {
            includedLines.add(nextLine);
            currentBytes += l;
            expanded = true;
          }
        }
      }
      distance++;
    }
  }

  const omittedLineRanges: Array<[number, number]> = [];
  let omitStart = -1;
  let omitPrev = -1;
  for (const line of allLineNumbers) {
    if (!includedLines.has(line)) {
      if (omitStart === -1) {
        omitStart = line;
        omitPrev = line;
      } else if (line === omitPrev + 1) {
        omitPrev = line;
      } else {
        omittedLineRanges.push([omitStart, omitPrev]);
        omitStart = line;
        omitPrev = line;
      }
    } else if (omitStart !== -1) {
      omittedLineRanges.push([omitStart, omitPrev]);
      omitStart = -1;
      omitPrev = -1;
    }
  }
  if (omitStart !== -1) omittedLineRanges.push([omitStart, omitPrev]);

  const finalLineNumbers = allLineNumbers.filter((l) => includedLines.has(l));
  if (finalLineNumbers.length === 0) return null;

  const windows: SearchWindow[] = [];
  let curStart = finalLineNumbers[0];
  let curContent = data.linesMap.get(finalLineNumbers[0])!;
  let prev = finalLineNumbers[0];
  for (let i = 1; i < finalLineNumbers.length; i++) {
    const cur = finalLineNumbers[i];
    if (cur === prev + 1) {
      curContent += data.linesMap.get(cur)!;
    } else {
      windows.push({
        startLine: curStart,
        endLine: prev,
        content: curContent,
        patterns: new Set([pattern]),
      });
      curStart = cur;
      curContent = data.linesMap.get(cur)!;
    }
    prev = cur;
  }
  windows.push({
    startLine: curStart,
    endLine: prev,
    content: curContent,
    patterns: new Set([pattern]),
  });

  return {
    file,
    windows,
    ...(omittedLineRanges.length > 0 ? { omittedLineRanges } : {}),
  };
}

export function planMerges(
  windows: Array<{ startLine: number; endLine: number }>,
  contextLines: number,
): MergePlan {
  const groups: number[][] = [];
  if (windows.length === 0) return { groups };

  const indexed = windows
    .map((w, i) => ({ w, i }))
    .sort((a, b) => a.w.startLine - b.w.startLine || a.w.endLine - b.w.endLine);

  let curGroup: number[] = [indexed[0].i];
  let curEnd = indexed[0].w.endLine;

  for (let i = 1; i < indexed.length; i++) {
    const w = indexed[i].w;
    const gap = w.startLine - curEnd - 1;
    if (w.startLine <= curEnd + 1 || gap <= contextLines) {
      curGroup.push(indexed[i].i);
      if (w.endLine > curEnd) curEnd = w.endLine;
    } else {
      groups.push(curGroup);
      curGroup = [indexed[i].i];
      curEnd = w.endLine;
    }
  }
  groups.push(curGroup);
  return { groups };
}

async function mergeWindowGroup(
  group: number[],
  windows: SearchWindow[],
  loadFileLines: () => Promise<string[]>,
): Promise<SearchWindow> {
  const sorted = group
    .map((i) => ({ idx: i, w: windows[i] }))
    .sort((a, b) => a.w.startLine - b.w.startLine);

  const first = sorted[0].w;
  const merged: SearchWindow = {
    startLine: first.startLine,
    endLine: first.endLine,
    content: first.content,
    patterns: new Set(first.patterns),
  };

  for (let i = 1; i < sorted.length; i++) {
    const w = sorted[i].w;
    for (const p of w.patterns) merged.patterns.add(p);

    if (w.startLine <= merged.endLine) {
      const overlapCount = merged.endLine - w.startLine + 1;
      const wLines = splitContentLines(w.content);
      if (wLines.length > overlapCount) {
        const tail = wLines.slice(overlapCount).join("\n") + "\n";
        merged.content += tail;
      }
      if (w.endLine > merged.endLine) merged.endLine = w.endLine;
    } else if (w.startLine === merged.endLine + 1) {
      merged.content += w.content;
      merged.endLine = w.endLine;
    } else {
      const all = await loadFileLines();
      const bridgeFrom = merged.endLine + 1;
      const bridgeTo = w.startLine - 1;
      const bridge = all.slice(bridgeFrom - 1, bridgeTo);
      if (bridge.length > 0) merged.content += bridge.join("\n") + "\n";
      merged.content += w.content;
      merged.endLine = w.endLine;
    }
  }
  return merged;
}

function splitContentLines(content: string): string[] {
  const lines = content.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function splitFileLines(raw: string): string[] {
  const lines = raw.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function extractSourceSymbols(patterns: string[]): string[] {
  const out: string[] = [];
  for (const p of patterns) {
    const cleaned = p.replace(/[^A-Za-z0-9_]/g, "");
    if (cleaned.length >= MIN_SYMBOL_LENGTH) out.push(cleaned);
  }
  return out;
}

export function findRelatedSymbols(content: string, sourceSymbols: string[]): string[] {
  const found = new Set<string>();
  for (const sym of sourceSymbols) {
    const esc = escapeRegex(sym);
    const patterns = [
      new RegExp(`\\bHandle${esc}\\b`, "g"),
      new RegExp(`\\bOn${esc}\\b`, "g"),
      new RegExp(`\\b${esc}Handler\\b`, "g"),
      new RegExp(`\\b${esc}Listener\\b`, "g"),
      new RegExp(`\\b${esc}Closed\\b`, "g"),
      new RegExp(`\\b${esc}Completed\\b`, "g"),
      new RegExp(`\\b${esc}Started\\b`, "g"),
    ];
    for (const re of patterns) {
      const matches = content.match(re);
      if (matches) for (const m of matches) found.add(m);
    }
  }
  return Array.from(found).sort().slice(0, RELATED_SYMBOL_CAP);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function mergeRanges(
  a: Array<[number, number]> | undefined,
  b: Array<[number, number]>,
): Array<[number, number]> {
  const merged: Array<[number, number]> = [...(a ?? []), ...b].map((r) => [r[0], r[1]]);
  merged.sort((x, y) => x[0] - y[0]);
  const out: Array<[number, number]> = [];
  for (const r of merged) {
    if (out.length === 0 || r[0] > out[out.length - 1][1] + 1) {
      out.push([r[0], r[1]]);
    } else {
      out[out.length - 1][1] = Math.max(out[out.length - 1][1], r[1]);
    }
  }
  return out;
}
