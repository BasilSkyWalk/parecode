import { ToolHost } from "../adapters/base.js";

export interface SearchArgs {
  pattern: string;
  paths?: string[];
  contextLines?: number;
  maxBytesPerFile?: number;
}

export interface SearchResult {
  status: "success" | "error";
  detail?: string;
  matches?: Array<{
    file: string;
    content: string;
    lineRanges: Array<[number, number]>;
    omittedLineRanges?: Array<[number, number]>;
  }>;
  recommendation?: string;
}

const LARGE_RESULT_TOKEN_THRESHOLD = 4000;

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

    const ctx = args.contextLines ?? 2;
    const paths = args.paths && args.paths.length > 0 ? args.paths : ["."];

    const rgArgs = ["--json", "-C", ctx.toString(), args.pattern, ...paths];
    this.host.log("info", "Spawning ripgrep", { rgArgs });

    const { stdout, code, stderr } = await this.host.exec(rgPath, rgArgs);

    if (code !== 0 && stdout.trim() === "") {
      if (code === 1) {
        return { status: "success", matches: [] };
      }
      this.host.log("error", "ripgrep failed", { code, stderr });
      return { status: "error", detail: `ripgrep exited with code ${code}` };
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
      } catch (err) {
      }
    }

    let actualTokens = 0;
    const matches: NonNullable<SearchResult["matches"]> = [];

    for (const [file, data] of fileMatches.entries()) {
      const allLineNumbers = Array.from(data.linesMap.keys()).sort((a, b) => a - b);
      if (allLineNumbers.length === 0) continue;

      let totalBytes = 0;
      for (const text of data.linesMap.values()) {
        totalBytes += Buffer.byteLength(text, "utf8");
      }

      let includedLines = new Set(allLineNumbers);

      if (args.maxBytesPerFile && totalBytes > args.maxBytesPerFile) {
        includedLines = new Set<number>();
        let currentBytes = 0;
        
        for (const matchLine of data.matchLines) {
          const text = data.linesMap.get(matchLine)!;
          const len = Buffer.byteLength(text, "utf8");
          if (currentBytes + len <= args.maxBytesPerFile) {
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
              const text = data.linesMap.get(prevLine)!;
              const len = Buffer.byteLength(text, "utf8");
              if (currentBytes + len <= args.maxBytesPerFile) {
                includedLines.add(prevLine);
                currentBytes += len;
                expanded = true;
              }
            }
            
            const nextLine = matchLine + distance;
            if (data.linesMap.has(nextLine) && !includedLines.has(nextLine)) {
              const text = data.linesMap.get(nextLine)!;
              const len = Buffer.byteLength(text, "utf8");
              if (currentBytes + len <= args.maxBytesPerFile) {
                includedLines.add(nextLine);
                currentBytes += len;
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
        } else {
          if (omitStart !== -1) {
            omittedLineRanges.push([omitStart, omitPrev]);
            omitStart = -1;
            omitPrev = -1;
          }
        }
      }
      if (omitStart !== -1) {
        omittedLineRanges.push([omitStart, omitPrev]);
      }

      const finalLineNumbers = allLineNumbers.filter(l => includedLines.has(l));
      if (finalLineNumbers.length === 0) continue;

      let content = "";
      const lineRanges: Array<[number, number]> = [];
      let currentRangeStart = finalLineNumbers[0];
      let previousLine = finalLineNumbers[0];

      content += data.linesMap.get(finalLineNumbers[0])!;

      for (let i = 1; i < finalLineNumbers.length; i++) {
        const currentLine = finalLineNumbers[i];
        if (currentLine === previousLine + 1) {
          content += data.linesMap.get(currentLine)!;
        } else {
          lineRanges.push([currentRangeStart, previousLine]);
          content += "\n---\n\n";
          content += data.linesMap.get(currentLine)!;
          currentRangeStart = currentLine;
        }
        previousLine = currentLine;
      }
      lineRanges.push([currentRangeStart, previousLine]);

      actualTokens += Math.ceil(content.length / 4);

      matches.push({
        file,
        content,
        lineRanges,
        ...(omittedLineRanges.length > 0 ? { omittedLineRanges } : {}),
      });
    }

    this.host.recordStat({
      toolCall: "ParecodeSearch",
      pattern: args.pattern,
      truncate: "v1-text",
      filesMatched: matches.length,
      actualTokens,
    });

    const isLargeResult = actualTokens > LARGE_RESULT_TOKEN_THRESHOLD;
    const recommendation = isLargeResult
      ? "Result is large. Consider narrowing 'paths', tightening the pattern, or dispatching a Haiku Task subagent to extract just the relevant section before consuming the full content."
      : undefined;

    return {
      status: "success",
      matches,
      ...(recommendation ? { recommendation } : {}),
    };
  }
}
