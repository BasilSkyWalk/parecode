import { ToolSpec } from "../adapters/base.js";

export const ParecodeEditToolSpec: ToolSpec = {
  name: "ParecodeEdit",
  description:
    "Edit files by providing an array of replacements. " +
    "Each replacement specifies the target file, the exact string to replace, and the new string. " +
    "Optionally, you can enable fuzzy matching for whitespace-tolerant matching.",
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
