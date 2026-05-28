import { ToolSpec } from "../adapters/base.js";

export const ParecodeSearchToolSpec: ToolSpec = {
  name: "ParecodeSearch",
  description:
    "Search the codebase with ripgrep and return matches with surrounding context in a single call. " +
    "Strongly prefer this over chained `find` / `xargs grep` / `grep -R` plus a follow-up Read: " +
    "ParecodeSearch returns only the relevant windows tagged with per-match estimatedTokens, so you " +
    "can budget the response before consuming it (skip matches with disproportionate estimatedTokens " +
    "unless you need them). " +
    "Pass `pattern` as an array of strings to dispatch parallel ripgrep runs sharing the same paths " +
    "and context — this is the right move for related-keyword flow tracing (e.g. " +
    "['HandleX', 'OnX', 'XClosed']) and replaces N back-to-back ParecodeSearch calls with one. " +
    "Each match reports `patterns: string[]` listing which input patterns contributed. " +
    "Overlapping or adjacent windows within the same file are merged automatically (gap ≤ contextLines). " +
    "Use for: 'find all callers of X', 'locate the definition of Y', 'trace this event flow across the repo'. " +
    "When CodeGraph is initialised in the repo (.codegraph/ present), prefer `codegraph_explore` for " +
    "broad 'how does X work?' questions; ParecodeSearch is still the right tool for targeted " +
    "multi-pattern lookups and for repos without CodeGraph. " +
    "Set `relatedSymbols: true` to surface likely event-flow neighbours (Handle<X>, On<X>, <X>Handler, " +
    "<X>Listener, <X>Closed/Completed/Started) discovered in each match — opt-in, capped per match. " +
    "Per-file chunking via maxBytesPerFile prevents context blowups; omitted ranges are reported in " +
    "omittedLineRanges so you can widen with ParecodeExpand without re-reading the whole file. " +
    "Supports regex patterns and optional path scoping.",
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
