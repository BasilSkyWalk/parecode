import { ToolSpec } from "../adapters/base.js";

export const ParecodeSearchToolSpec: ToolSpec = {
  name: "ParecodeSearch",
  description:
    "Search the codebase with ripgrep and return matches with surrounding context in a single call. " +
    "Prefer this over Grep + Read when you would otherwise read multiple files to see match context — " +
    "ParecodeSearch returns only the relevant windows, saving substantial tokens on large files. " +
    "Use for: 'find all callers of X', 'locate the definition of Y', 'show usages across the repo'. " +
    "Per-file chunking via maxBytesPerFile prevents context blowups; omitted ranges are reported in " +
    "omittedLineRanges so you can request a specific window without re-reading the whole file. " +
    "Supports regex patterns and optional path scoping.",
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
      }
    },
    required: ["pattern"]
  },
};
