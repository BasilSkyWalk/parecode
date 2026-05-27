import { ToolHost } from "../adapters/base.js";
import { ASTProcessor } from "./ast.js";

export interface SearchArgs {
  pattern: string;
  paths?: string[];
  contextLines?: number;
  truncate?: "none" | "signatures" | "full";
}

export interface SearchResult {
  status: "success" | "error";
  detail?: string;
  matches?: Array<{
    file: string;
    content: string;
    degraded?: boolean;
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

    const truncate = args.truncate || "none";
    const paths = args.paths && args.paths.length > 0 ? args.paths : ["."];

    const rgArgs = ["-l", args.pattern, ...paths];
    this.host.log("info", "Spawning ripgrep", { rgArgs });

    const { stdout, code, stderr } = await this.host.exec(rgPath, rgArgs);

    if (code !== 0 && stdout.trim() === "") {
      if (code === 1) {
        return { status: "success", matches: [] };
      }
      this.host.log("error", "ripgrep failed", { code, stderr });
      return { status: "error", detail: `ripgrep exited with code ${code}` };
    }

    const files = stdout.trim().split("\n").filter(Boolean);
    const ast = new ASTProcessor();

    let estimatedNativeTokens = 0;
    let actualTokens = 0;

    const matches = await Promise.all(
      files.map(async (file) => {
        try {
          const content = await this.host.readFile(file);
          const result = ast.process(content, { truncate });
          
          estimatedNativeTokens += Math.ceil(content.length / 4);
          actualTokens += Math.ceil(result.content.length / 4);
          
          return {
            file,
            content: result.content,
            degraded: result.degraded,
          };
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          this.host.log("warn", `Failed to read matched file: ${file}`, { error: errMsg });
          return null;
        }
      })
    );

    const finalMatches = matches.filter((m): m is NonNullable<typeof m> => m !== null);

    this.host.recordStat({
      toolCall: "ParecodeSearch",
      pattern: args.pattern,
      truncate,
      filesMatched: finalMatches.length,
      estimatedNativeTokens,
      actualTokens,
    });

    return {
      status: "success",
      matches: finalMatches,
    };
  }
}
