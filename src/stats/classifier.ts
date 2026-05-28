import { TranscriptRecord } from "./transcriptParser.js";

export type CallClass =
  | "replaceable_search"
  | "replaceable_edit"
  | "read_followups"
  | "unchanged";

export function classifyToolCalls(records: TranscriptRecord[]): (CallClass | null)[] {
  const results: (CallClass | null)[] = [];

  let lastSearchIndex = -1;
  let lastUserMessageIndex = -1;

  for (let i = 0; i < records.length; i++) {
    const record = records[i];

    if (
      record.type === "user" ||
      record.type === "USER_INPUT" ||
      record.type === "user_message"
    ) {
      lastUserMessageIndex = i;
    }

    if (!record.toolName) {
      results.push(null);
      continue;
    }

    const name = record.toolName;

    if (name === "Grep" || name === "Glob") {
      results.push("replaceable_search");
      lastSearchIndex = i;
      continue;
    }

    if (name === "Bash") {
      const cmd = String(record.input?.command || "");
      if (cmd.includes("grep") || cmd.includes("find ")) {
        results.push("replaceable_search");
        lastSearchIndex = i;
        continue;
      }
    }

    if (name === "Edit" || name === "MultiEdit" || name === "Write") {
      results.push("replaceable_edit");
      continue;
    }

    if (name === "Read") {
      if (lastSearchIndex !== -1 && lastSearchIndex > lastUserMessageIndex) {
        results.push("read_followups");
        continue;
      }
    }

    results.push("unchanged");
  }

  return results;
}
