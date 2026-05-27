import { ToolSpec } from "../adapters/base.js";

export const ParecodeSearchToolSpec: ToolSpec = {
  name: "ParecodeSearch",
  description: 
    "Search across the codebase using ripgrep with optional AST-aware truncation. " +
    "Use this tool to explore code quickly without consuming excessive context tokens. " +
    "CRITICAL: When exploring structure, APIs, or classes, ALWAYS set `truncate: 'signatures'` " +
    "to return only function and method signatures (stripping bodies). " +
    "If you need full implementations for a specific file, set `truncate: 'none'` (or omit). " +
    "The search supports regex patterns and optionally restricts to specific paths.",
  inputSchema: {
    type: "object",
    properties: {
      pattern: { 
        type: "string", 
        description: "Ripgrep regex search pattern" 
      },
      paths: { 
        type: "array", 
        items: { type: "string" }, 
        description: "List of directory or file paths to restrict the search" 
      },
      contextLines: { 
        type: "number", 
        description: "Number of context lines to include around matches. Defaults to 2." 
      },
      maxBytesPerFile: {
        type: "number",
        description: "Maximum bytes to return per file before chunking/truncating the output."
      },
      truncate: { 
        type: "string", 
        enum: ["none", "signatures", "full"], 
        description: "Truncation mode (v0 legacy). Use 'signatures' to strip function bodies and save tokens." 
      }
    },
    required: ["pattern"]
  },
};
