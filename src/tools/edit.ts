import { ToolSpec } from "../adapters/base.js";

export const ParecodeEditToolSpec: ToolSpec = {
  name: "ParecodeEdit",
  description:
    "Apply many edits across many files in one call — the edit counterpart to ParecodeSearch/ParecodeExpand. " +
    "Prefer over native Edit/MultiEdit for 2+ edits to one file, edits across files (files apply in parallel), " +
    "or one logical revision that should land together. Each item is a line-range op (replaceLines or " +
    "insertAfter, guarded by an `expect` anchor) or a string-patch op (oldString/newString; fuzzy:true tolerates " +
    "whitespace drift, 'aggressive' also normalizes Unicode look-alikes). Strongly prefer line-range ops when " +
    "you know the target lines — e.g. the line numbers ParecodeSearch returned: a line number plus a " +
    "short `expect` anchor skips constructing exact-match snippets, so recurring text (a repeated call) can't " +
    "trigger the multiple-match errors and retries an oldString needs extra context to avoid. Reserve oldString " +
    "for edits with no known lines. Atomicity is per file, NOT cross-file: within a file all ops apply or none, " +
    "other files commit independently — check each result's status. Writes are atomic with mtime conflict " +
    "detection; fuzzy fails closed on low confidence or ambiguity.",
  inputSchema: {
    type: "object",
    properties: {
      edits: {
        type: "array",
        description: "List of edit operations to perform",
        items: {
          type: "object",
          properties: {
            file: {
              type: "string",
              description: "Path (absolute or relative) to the file to edit. Edits are grouped by file and applied all-or-nothing per file; the per-file status is one of success, conflict (file changed underneath the edit), error, snippet_mismatch, or fuzzy_match_failed. On snippet_mismatch the op result carries an `actual` snapshot (line-numbered current contents at the target) so you can correct the anchor/line numbers in place without re-reading the file."
            },
            replaceLines: {
              type: "array",
              items: { type: "number" },
              minItems: 2,
              maxItems: 2,
              description: "Line-range op: inclusive [start, end] 1-based line range to replace with `content`. Pair with `content` and an `expect` anchor."
            },
            insertAfter: {
              type: "number",
              description: "Line-range op: insert `content` after this 1-based line number (0 = top of file). Pair with `content` and an `expect` anchor (the anchor is skipped when 0)."
            },
            content: {
              type: "string",
              description: "Replacement or inserted text for the line-range ops (replaceLines / insertAfter)."
            },
            expect: {
              type: "string",
              description: "Anchor verifying the target before any write: the trimmed first line, or first and last line joined by `\\n…\\n` for ranges. If the lines drifted, the first-line anchor is re-located within ±20 lines, the range keeps its original length, and the last-line anchor is re-verified at the new position. Relocating a multi-line replaceLines range requires the two-ended (`\\n…\\n`) form — a single-line anchor that has drifted returns snippet_mismatch rather than overwriting an unverified range. If the anchor is missing or matches more than one nearby location, the op returns snippet_mismatch and nothing in that file is written."
            },
            oldString: {
              type: "string",
              description: "String-patch op: exact text to replace. Must match exactly once — multiple occurrences error out — unless `fuzzy` is set."
            },
            newString: {
              type: "string",
              description: "String-patch op: replacement text for oldString."
            },
            fuzzy: {
              anyOf: [
                { type: "boolean" },
                { type: "string", enum: ["aggressive"] }
              ],
              description: "String-patch tolerance: true = whitespace-insensitive matching; 'aggressive' = also normalize Unicode look-alikes (NFKD). Beyond whitespace it tolerates only ~5% character drift — short strings must match exactly after whitespace normalization — and it fails closed (fuzzy_match_failed) rather than guessing; if several locations match, the op errors out instead of picking one. Replacements adopt the file's existing indentation when it differs from oldString. Omit for exact-only matching."
            }
          },
          required: ["file"],
          oneOf: [
            { required: ["replaceLines", "content", "expect"] },
            { required: ["insertAfter", "content", "expect"] },
            { required: ["oldString", "newString"] }
          ]
        }
      }
    },
    required: ["edits"]
  }
};
