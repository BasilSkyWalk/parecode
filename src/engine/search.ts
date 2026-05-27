import { ToolHost } from "../adapters/base.js";

export interface SearchArgs {
  pattern: string;
  paths?: string[];
  contextLines?: number; // default 2
  maxBytesPerFile?: number;
  truncate?: "none" | "signatures" | "full";
}

export interface SearchResult {
  status: "success" | "error";
  detail?: string;
  matches?: Array<{
    file: string;
    content: string;
    lineRanges: Array<[number, number]>;
  }>;
}

export class SearchEngine {
  constructor(private host: ToolHost) {}

  public async search(args: SearchArgs): Promise<SearchResult> {
    const rgPath = await this.host.resolveCommand("rg");
    if (!rgPath) {
      this.host.log("error", "ripgrep not found via which");
      return {
        status: "error",
        detail: "ripgrep not found on PATH. Please install it.",
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
    const fileMatches = new Map<string, { linesMap: Map<number, string> }>();

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        if (parsed.type === "match" || parsed.type === "context") {
          const file = parsed.data.path.text;
          const lineNum = parsed.data.line_number;
          const text = parsed.data.lines.text;
          
          if (!fileMatches.has(file)) {
            fileMatches.set(file, { linesMap: new Map() });
          }
          fileMatches.get(file)!.linesMap.set(lineNum, text);
        }
      } catch (err) {
        // ignore parse errors
      }
    }

    let actualTokens = 0;
    const matches: NonNullable<SearchResult["matches"]> = [];

    for (const [file, data] of fileMatches.entries()) {
      const lineNumbers = Array.from(data.linesMap.keys()).sort((a, b) => a - b);
      if (lineNumbers.length === 0) continue;

      let content = "";
      const lineRanges: Array<[number, number]> = [];
      let currentRangeStart = lineNumbers[0];
      let previousLine = lineNumbers[0];

      content += data.linesMap.get(lineNumbers[0])!;

      for (let i = 1; i < lineNumbers.length; i++) {
        const currentLine = lineNumbers[i];
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
      });
    }

    this.host.recordStat({
      toolCall: "ParecodeSearch",
      pattern: args.pattern,
      truncate: "v1-text",
      filesMatched: matches.length,
      actualTokens,
    });

    return {
      status: "success",
      matches,
    };
  }
}
