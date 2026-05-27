import { ToolHost } from "../adapters/base.js";
import { resolveRipgrep, spawnCommand } from "../infra/spawn.js";
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
  }>;
}

export class SearchEngine {
  constructor(private host: ToolHost) {}

  public async search(args: SearchArgs): Promise<SearchResult> {
    const rgPath = await resolveRipgrep();
    if (!rgPath) {
      this.host.log("error", "ripgrep not found via which");
      return {
        status: "error",
        detail: "ripgrep not found on PATH. Please install it.",
      };
    }

    const truncate = args.truncate || "none";
    const paths = args.paths && args.paths.length > 0 ? args.paths : ["."];

    // Use `rg -l` to get matching files for prototype
    const rgArgs = ["-l", args.pattern, ...paths];
    this.host.log("info", "Spawning ripgrep", { rgArgs });

    const { stdout, code, stderr } = await spawnCommand(rgPath, rgArgs);

    if (code !== 0 && stdout.trim() === "") {
      // ripgrep returns 1 when no matches are found
      if (code === 1) {
        return { status: "success", matches: [] };
      }
      this.host.log("error", "ripgrep failed", { code, stderr });
      return { status: "error", detail: `ripgrep exited with code ${code}` };
    }

    const files = stdout.trim().split("\n").filter(Boolean);
    const ast = new ASTProcessor();

    // Parallel file reads
    const matches = await Promise.all(
      files.map(async (file) => {
        try {
          const content = await this.host.readFile(file);
          const processedContent = ast.process(content, { truncate });
          return {
            file,
            content: processedContent,
          };
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          this.host.log("warn", `Failed to read matched file: ${file}`, { error: errMsg });
          return null;
        }
      })
    );

    return {
      status: "success",
      matches: matches.filter((m): m is NonNullable<typeof m> => m !== null),
    };
  }
}
