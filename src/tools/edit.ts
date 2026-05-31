import { ToolSpec } from "../adapters/base.js";

export const ParecodeEditToolSpec: ToolSpec = {
  name: "ParecodeEdit",
  description:
    "Apply many edits across many files in one call — the edit counterpart to ParecodeSearch/ParecodeExpand. " +
    "Prefer over native Edit/MultiEdit when: (a) making 2+ edits to one file, or edits across files " +
    "(files apply in parallel); (b) an oldString from an earlier read may have drifted — set fuzzy:true " +
    "(whitespace-tolerant) or fuzzy:'aggressive' (also normalizes Unicode look-alikes); (c) the changes are " +
    "one logical revision that should land together. Each item is either a line-range op (replaceLines or " +
    "insertAfter, each guarded by an `expect` anchor — the primary path) or a string-patch op " +
    "(oldString/newString — the fallback). Atomicity is per file, NOT cross-file: within a file all ops apply " +
    "or none do, but other files commit independently, so check each result's status. Writes are atomic " +
    "(temp+rename) with mtime conflict detection (a concurrent external edit returns `conflict` with no write); " +
    "fuzzy matching fails closed below 0.85 confidence.",
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
              description: "Path (absolute or relative) to the file to edit. Edits are grouped by file and applied all-or-nothing per file; the per-file status is one of success, conflict (file changed underneath the edit), error, snippet_mismatch, or fuzzy_match_failed."
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
              description: "Anchor verifying the target before any write: the trimmed first line, or first and last line joined by `\\n…\\n` for ranges. If the lines drifted it is re-located by fuzzy match within ±20 lines at ≥0.85 confidence; if not found, the op returns snippet_mismatch and nothing in that file is written."
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
              description: "String-patch tolerance: true = whitespace-insensitive matching; 'aggressive' = also normalize Unicode look-alikes (NFKD). Below 0.85 confidence it fails closed (fuzzy_match_failed) rather than guessing. Omit for exact-only matching."
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
