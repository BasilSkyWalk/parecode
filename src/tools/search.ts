import { ToolSpec } from "../adapters/base.js";

export const ParecodeSearchToolSpec: ToolSpec = {
  name: "ParecodeSearch",
  description:
    "Search the codebase with ripgrep and return matches with context in a single call. " +
    "Prefer over native grep/find for targeted multi-pattern lookups or when needing context windows. " +
    "Results ≤ 2KB are auto-inlined; larger results return locations only to be widened " +
    "via ParecodeExpand. Supports regex and path scoping.",
  inputSchema: {
    type: "object",
    properties: {
      pattern: {
        anyOf: [
          { type: "string" },
          { type: "array", items: { type: "string" }, minItems: 1 },
        ],
        description:
          "Ripgrep regex pattern, or an array of patterns to dispatch in parallel. Each match reports which input pattern(s) contributed via 'patterns'.",
      },
      paths: {
        type: "array",
        items: { type: "string" },
        description: "List of directory or file paths to restrict the search",
      },
      contextLines: {
        type: "number",
        description:
          "Number of context lines to include around matches. Defaults to 2. Also controls window-merge threshold within a file.",
      },
      maxBytesPerFile: {
        type: "number",
        description: "Maximum bytes to return per file before chunking the output around match centers.",
      },
      relatedSymbols: {
        type: "boolean",
        description:
          "Opt-in: scan each match's content for likely related symbols (Handle<X>, On<X>, <X>Handler, <X>Listener, <X>Closed/Completed/Started). Returns deduped, lexically sorted, capped at 10 per match.",
      },
    },
    required: ["pattern"],
  },
};
