import { ToolSpec } from "../adapters/base.js";

export const ParecodeEditToolSpec: ToolSpec = {
  name: "ParecodeEdit",
  description:
    "Apply many edits across many files in a single call. " +
    "Prefer this over Edit / MultiEdit when: " +
    "(a) editing across multiple files — cross-file edits run in parallel; " +
    "(b) the exact oldString from a stale read may not match anymore — set fuzzy: true for whitespace-tolerant matching, or fuzzy: 'aggressive' for Unicode-lookalike normalization (avoids a forced re-read on whitespace drift); " +
    "(c) you have a batch of related changes that would otherwise be N sequential Edit calls. " +
    "Atomic writes plus mtime-based concurrency control make it safe under parallel agents. " +
    "Fuzzy matching fails closed below 0.85 confidence and reports status: 'fuzzy_match_failed' so other edits in the batch still apply.",
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
