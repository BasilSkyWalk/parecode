import { ToolSpec } from "../adapters/base.js";

export const ParecodeExpandToolSpec: ToolSpec = {
  name: "ParecodeExpand",
  description:
    "Widen a known (file, startLine, endLine) range — the natural follow-up to a ParecodeSearch match. " +
    "Use this instead of a full-file Read whenever you already know roughly where the interesting " +
    "code lives and just need more surrounding context. Returns the requested slice plus optional " +
    "contextBefore/contextAfter padding, with estimatedTokens reported in the same form as " +
    "ParecodeSearch so you can apply the same self-budgeting heuristic before consuming the content. " +
    "Prefer this over Read with offset/limit: same mechanics, but the response shape and token " +
    "estimate make widening match-relative regions cheap and predictable. " +
    "Out-of-range lines are clamped silently; the returned lineRange reflects the actual slice.",
  inputSchema: {
    type: "object",
    properties: {
      file: { type: "string", description: "Path to the file to read" },
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
