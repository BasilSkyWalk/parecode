import * as readline from "node:readline";
import { createReadStream } from "node:fs";

export interface TranscriptTokens {
  input?: number;
  output?: number;
}

export interface TranscriptRecord {
  type?: string;
  toolName?: string;
  input?: Record<string, unknown>;
  tokens?: TranscriptTokens;
  raw?: unknown;
}

export function parseTranscriptLine(line: string): TranscriptRecord | null {
  if (!line.trim()) return null;
  try {
    const obj = JSON.parse(line) as Record<string, unknown>;

    const toolName =
      obj.toolName ??
      obj.tool_name ??
      (obj.toolCall as Record<string, unknown>)?.name ??
      obj.name;

    const type = obj.type;

    let input = obj.input ?? obj.arguments ?? (obj.toolCall as Record<string, unknown>)?.arguments;
    if (typeof input === "string") {
      try {
        input = JSON.parse(input);
      } catch {
        input = {};
      }
    }
    if (typeof input !== "object" || input === null) {
      input = {};
    }

    const tokens = obj.tokens as Record<string, unknown> | undefined;
    const usage = obj.usage as Record<string, unknown> | undefined;

    const inputTokens = tokens?.input ?? usage?.prompt_tokens ?? usage?.input_tokens;
    const outputTokens = tokens?.output ?? usage?.completion_tokens ?? usage?.output_tokens;

    return {
      type: typeof type === "string" ? type : undefined,
      toolName: typeof toolName === "string" ? toolName : undefined,
      input: input as Record<string, unknown>,
      tokens: {
        input: typeof inputTokens === "number" ? inputTokens : undefined,
        output: typeof outputTokens === "number" ? outputTokens : undefined,
      },
      raw: obj,
    };
  } catch {
    return null;
  }
}

export async function parseTranscriptFile(filePath: string): Promise<TranscriptRecord[]> {
  const records: TranscriptRecord[] = [];
  try {
    const fileStream = createReadStream(filePath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      const record = parseTranscriptLine(line);
      if (record) {
        records.push(record);
      }
    }
  } catch {
  }
  return records;
}
