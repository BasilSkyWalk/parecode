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
}

const ALLOWED_STRUCTURED_KEYS = ["path", "paths", "pattern", "patterns"];

function filterInput(input: unknown, includeContent: boolean): Record<string, unknown> {
  if (typeof input !== "object" || input === null) return {};
  const obj = input as Record<string, unknown>;
  if (includeContent) return obj;
  const out: Record<string, unknown> = {};
  for (const k of ALLOWED_STRUCTURED_KEYS) {
    if (k in obj) out[k] = obj[k];
  }
  return out;
}

function coerceInput(raw: unknown): unknown {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  return raw;
}

function parseClaudeCodeShape(obj: Record<string, unknown>, includeContent: boolean): TranscriptRecord[] | null {
  const type = typeof obj.type === "string" ? obj.type : undefined;
  if (type !== "assistant" && type !== "user") return null;

  const message = obj.message as Record<string, unknown> | undefined;
  if (!message || typeof message !== "object") {
    return type === "user" ? [{ type: "user" }] : null;
  }

  if (type === "user") {
    return [{ type: "user" }];
  }

  const content = message.content;
  if (!Array.isArray(content)) return null;

  const usage = message.usage as Record<string, unknown> | undefined;
  const inputTokens = pickNumber(
    usage?.input_tokens,
    sumNumeric(usage?.input_tokens, usage?.cache_read_input_tokens, usage?.cache_creation_input_tokens),
  );
  const outputTokens = pickNumber(usage?.output_tokens);

  const records: TranscriptRecord[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const b = block as Record<string, unknown>;
    if (b.type !== "tool_use") continue;
    const name = typeof b.name === "string" ? b.name : undefined;
    if (!name) continue;
    records.push({
      type: "tool_call",
      toolName: name,
      input: filterInput(coerceInput(b.input), includeContent),
      tokens: { input: inputTokens, output: outputTokens },
    });
  }
  return records;
}

function pickNumber(...values: unknown[]): number | undefined {
  for (const v of values) {
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return undefined;
}

function sumNumeric(...values: unknown[]): number | undefined {
  let total = 0;
  let any = false;
  for (const v of values) {
    if (typeof v === "number" && Number.isFinite(v)) {
      total += v;
      any = true;
    }
  }
  return any ? total : undefined;
}

function parseLegacyShape(obj: Record<string, unknown>, includeContent: boolean): TranscriptRecord | null {
  const toolName =
    obj.toolName ??
    obj.tool_name ??
    (obj.toolCall as Record<string, unknown>)?.name ??
    obj.name;

  const type = obj.type;
  const hasUserType =
    type === "user" || type === "USER_INPUT" || type === "user_message";

  if (typeof toolName !== "string" && !hasUserType) {
    return null;
  }

  const rawInput =
    obj.input ?? obj.arguments ?? (obj.toolCall as Record<string, unknown>)?.arguments;
  const coerced = coerceInput(rawInput);

  const tokens = obj.tokens as Record<string, unknown> | undefined;
  const usage = obj.usage as Record<string, unknown> | undefined;
  const inputTokens = pickNumber(tokens?.input, usage?.prompt_tokens, usage?.input_tokens);
  const outputTokens = pickNumber(tokens?.output, usage?.completion_tokens, usage?.output_tokens);

  return {
    type: typeof type === "string" ? type : undefined,
    toolName: typeof toolName === "string" ? toolName : undefined,
    input: filterInput(coerced, includeContent),
    tokens: { input: inputTokens, output: outputTokens },
  };
}

export function parseTranscriptLine(line: string, includeContent = false): TranscriptRecord[] {
  if (!line.trim()) return [];
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return [];
  }

  const claudeCode = parseClaudeCodeShape(obj, includeContent);
  if (claudeCode !== null) return claudeCode;

  const legacy = parseLegacyShape(obj, includeContent);
  return legacy ? [legacy] : [];
}

export async function parseTranscriptFile(filePath: string, includeContent = false): Promise<TranscriptRecord[]> {
  const records: TranscriptRecord[] = [];
  try {
    const fileStream = createReadStream(filePath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      const parsed = parseTranscriptLine(line, includeContent);
      for (const r of parsed) records.push(r);
    }
  } catch {
  }
  return records;
}
