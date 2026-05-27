import { ToolSpec } from "../adapters/base.js";

export const ParecodeSearchToolSpec: ToolSpec = {
  name: "ParecodeSearch",
  description: 
    "Search across the codebase using ripgrep. " +
    "Use this tool to find code quickly without consuming excessive context tokens. " +
    "Returns structured matches with a window of context lines around each match. " +
    "If a file has too many matches, the result is automatically chunked to stay within maxBytesPerFile, " +
    "and omitted lines are listed as omittedLineRanges. " +
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
      }
    },
    required: ["pattern"]
  },
};
