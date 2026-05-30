import { ToolSpec } from "../adapters/base.js";

export const ParecodeExpandToolSpec: ToolSpec = {
  name: "ParecodeExpand",
  description:
    "Widen a known (file, startLine, endLine) range. " +
    "Prefer over native Read when you already know roughly where the interesting code lives " +
    "and just need more surrounding context. Clamps out-of-range lines silently; the " +
    "returned lineRange reflects the actual slice.",
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
