import { ToolSpec } from "../adapters/base.js";

export const ParecodeEditToolSpec: ToolSpec = {
  name: "ParecodeEdit",
  description:
    "Apply many edits across many files in a single call. Prefer over native Edit/MultiEdit " +
    "for batch cross-file changes or when using line-range mode. Supports line-range ops " +
    "(replaceLines, insertAfter) with 'expect' anchors, and string-patch ops " +
    "(oldString/newString) with fuzzy matching. Atomic per-file.",
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
              description: "Absolute or relative path to the file to edit"
            },
            replaceLines: {
              type: "array",
              items: { type: "number" },
              minItems: 2,
              maxItems: 2,
              description: "Inclusive [start, end] line range to replace"
            },
            insertAfter: {
              type: "number",
              description: "Line number after which to insert content (0 for top of file)"
            },
            content: {
              type: "string",
              description: "New content for line-range operations"
            },
            expect: {
              type: "string",
              description: "Short anchor string to verify target (first line\\n…\\nlast line for ranges)"
            },
            oldString: {
              type: "string",
              description: "The exact string to find and replace (string-patch fallback)"
            },
            newString: {
              type: "string",
              description: "The new string to replace it with (string-patch fallback)"
            },
            fuzzy: {
              anyOf: [
                { type: "boolean" },
                { type: "string", enum: ["aggressive"] }
              ],
              description: "If true, allows whitespace-tolerant matching for string-patch fallback."
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
