import { ToolSpec } from "../adapters/base.js";

export const ParecodeEditToolSpec: ToolSpec = {
  name: "ParecodeEdit",
  description:
    "Safely edit files by providing an array of replacements. " +
    "This tool performs atomic writes and uses mtime-based concurrency control to prevent conflicts. " +
    "Each edit requires the target file, the exact old string to replace, and the new string. " +
    "Edits across different files run in parallel, while multiple edits to the same file are serialized. " +
    "If exact matching fails, you can enable fuzzy matching (`true` for whitespace tolerance, or `'aggressive'` for Unicode normalization). " +
    "Fuzzy matching fails closed if the match confidence is below 0.85.",
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
            oldString: {
              type: "string",
              description: "The exact string to find and replace"
            },
            newString: {
              type: "string",
              description: "The new string to replace it with"
            },
            fuzzy: {
              anyOf: [
                { type: "boolean" },
                { type: "string", enum: ["aggressive"] }
              ],
              description: "If true, allows whitespace-tolerant matching. If 'aggressive', also normalizes Unicode lookalikes."
            }
          },
          required: ["file", "oldString", "newString"]
        }
      }
    },
    required: ["edits"]
  }
};
