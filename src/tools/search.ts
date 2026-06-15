import { ToolSpec } from "../adapters/base.js";

export const ParecodeSearchToolSpec: ToolSpec = {
  name: "ParecodeSearch",
  description:
    "Search the codebase with ripgrep and get matches plus surrounding context in ONE call — " +
    "use instead of Grep/Glob-then-Read, a raw `rg`/`grep` in the shell, or re-reading the same file " +
    "at different line ranges. Pass `pattern` as an array to run several regexes in parallel for flow " +
    "tracing; each match lists which `patterns` hit it. Overlapping or " +
    "adjacent windows in a file are merged (gap ≤ contextLines), and the result carries one envelope-level " +
    "`estimatedTokens` so you can budget before consuming. Read-only: widen a match with ParecodeExpand, " +
    "change code with ParecodeEdit. Per-file content over ~2KB is dropped (lines listed in `omittedLineRanges`) " +
    "— widen those via ParecodeExpand rather than re-reading. Repeated calls in a session are token-efficient: " +
    "previously-returned windows come back as `kind: 'reference'` placeholders. Only need WHERE, not surrounding " +
    "code? Add `mode: 'locate'` for hits-only results (file + line + matched line, no content windows), then " +
    "ParecodeExpand what matters. Watch `warnings` — a `pattern_directory_collision` usually means narrow the " +
    "pattern first. Needs ripgrep on PATH (run `parecode doctor` if missing). In CodeGraph repos (.codegraph/), " +
    "prefer codegraph_explore for broad 'how does X work?' questions; best for targeted multi-pattern lookups.",
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
        description: "Directory or file paths to restrict the search. Defaults to the current working directory.",
      },
      contextLines: {
        type: "number",
        description:
          "Number of context lines to include around matches. Defaults to 2. Also controls window-merge threshold within a file.",
      },
      maxBytesPerFile: {
        type: "number",
        description: "Soft cap on bytes returned per file; above it, output is chunked around match centers and the trimmed lines are reported in omittedLineRanges (widen them with ParecodeExpand).",
      },
      relatedSymbols: {
        type: "boolean",
        description:
          "Opt-in: scan each match's content for likely related symbols (Handle<X>, On<X>, <X>Handler, <X>Listener, <X>Closed/Completed/Started). Returns deduped, lexically sorted, capped at 10 per match.",
      },
      mode: {
        type: "string",
        enum: ["locate"],
        description: "Set to 'locate' to return only hit locations (file + line + matched line) with no content windows — the lean option for broad fan-out searches across many files. Follow up with ParecodeExpand on the locations you care about. Omit for the default windowed result.",
      },
    },
    required: ["pattern"],
  },
};
