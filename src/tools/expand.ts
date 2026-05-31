import { ToolSpec } from "../adapters/base.js";

export const ParecodeExpandToolSpec: ToolSpec = {
  name: "ParecodeExpand",
  description:
    "Read a specific line range of a file — the natural follow-up to a ParecodeSearch match or an " +
    "`omittedLineRanges` entry it returned. Use instead of a full-file Read (or Read with offset/limit) " +
    "when you already know roughly where the code lives and just need more lines around it. Give the known " +
    "(file, startLine, endLine) and optionally pad with contextBefore/contextAfter; out-of-range lines are " +
    "clamped silently and the returned `lineRange` reflects the actual slice. Reports `estimatedTokens` in " +
    "the same form as ParecodeSearch so you can budget before consuming. Read-only — to change code use ParecodeEdit.",
  inputSchema: {
    type: "object",
    properties: {
      file: { type: "string", description: "Path to the file to read (typically the `file` from a ParecodeSearch match)." },
      startLine: { type: "number", description: "Starting line (1-based, inclusive)" },
      endLine: { type: "number", description: "Ending line (1-based, inclusive)" },
      contextBefore: {
        type: "number",
        description: "Additional lines to include before startLine. Default 0.",
      },
      contextAfter: {
        type: "number",
        description: "Additional lines to include after endLine. Default 0.",
      },
    },
    required: ["file", "startLine", "endLine"],
  },
};
