import { ToolHost } from "../adapters/base.js";
import { estimateTokens } from "../stats/estimator.js";

export interface ExpandArgs {
  file: string;
  startLine: number;
  endLine: number;
  contextBefore?: number;
  contextAfter?: number;
}

export interface ExpandResult {
  status: "success" | "error";
  file: string;
  content?: string;
  lineRange?: [number, number];
  estimatedTokens?: number;
  detail?: string;
}

export class ExpandEngine {
  constructor(private host: ToolHost) {}

  public async expand(args: ExpandArgs): Promise<ExpandResult> {
    if (
      !Number.isInteger(args.startLine) ||
      !Number.isInteger(args.endLine) ||
      (args.contextBefore !== undefined && !Number.isInteger(args.contextBefore)) ||
      (args.contextAfter !== undefined && !Number.isInteger(args.contextAfter))
    ) {
      throw new Error("startLine, endLine, contextBefore, contextAfter must be integers");
    }
    if (args.startLine < 1) {
      throw new Error("startLine must be >= 1");
    }
    if (args.endLine < args.startLine) {
      throw new Error("endLine must be >= startLine");
    }
    const before = args.contextBefore ?? 0;
    const after = args.contextAfter ?? 0;
    if (before < 0 || after < 0) {
      throw new Error("contextBefore and contextAfter must be >= 0");
    }

    let raw: string;
    let nativeSize = 0;
    try {
      raw = await this.host.readFile(args.file);
      nativeSize = Buffer.byteLength(raw, "utf8");
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      const detail = code === "ENOENT" ? "file_not_found" : "read_failed";
      this.host.log("warn", "expand read failed", { file: args.file, code });
      return { status: "error", file: args.file, detail };
    }

    const lines = raw.split(/\r?\n/);
    if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
    const fileLineCount = lines.length;

    if (fileLineCount === 0) {
      return { status: "error", file: args.file, detail: "empty_range" };
    }

    const startClamped = Math.max(1, Math.min(args.startLine - before, fileLineCount));
    const endClamped = Math.max(1, Math.min(args.endLine + after, fileLineCount));

    if (startClamped > endClamped) {
      return { status: "error", file: args.file, detail: "empty_range" };
    }

    const slice = lines.slice(startClamped - 1, endClamped).join("\n") + "\n";
    const estimatedTokens = estimateTokens(slice);

    this.host.recordStat({
      toolCall: "ParecodeExpand",
      file: args.file,
      estimatedNativeTokens: Math.ceil(nativeSize / 4),
      actualTokens: estimatedTokens,
      callsBatched: 1,
    });

    return {
      status: "success",
      file: args.file,
      content: slice,
      lineRange: [startClamped, endClamped],
      estimatedTokens,
    };
  }
}
