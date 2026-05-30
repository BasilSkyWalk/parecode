import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as readline from "node:readline";
import { createReadStream } from "node:fs";
import {
  listProjectDirs,
  listSessionFiles,
  decodeProjectName,
  transcriptDirExists,
} from "../infra/claudeCodeTranscripts.js";

export interface SessionTokenSummary {
  sessionId: string;
  project: string;
  inputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
  outputTokens: number;
  assistantTurns: number;
  firstTimestamp?: string;
  lastTimestamp?: string;
}

export interface AggregateTokenSummary {
  sessions: SessionTokenSummary[];
  totals: {
    sessions: number;
    inputTokens: number;
    cacheReadTokens: number;
    cacheCreateTokens: number;
    outputTokens: number;
    assistantTurns: number;
  };
}

function pickNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export async function summarizeSessionTokens(filePath: string): Promise<SessionTokenSummary> {
  const sessionId = path.basename(filePath).replace(/\.jsonl$/, "");
  const project = decodeProjectName(path.dirname(filePath));

  const summary: SessionTokenSummary = {
    sessionId,
    project,
    inputTokens: 0,
    cacheReadTokens: 0,
    cacheCreateTokens: 0,
    outputTokens: 0,
    assistantTurns: 0,
  };

  try {
    await fs.access(filePath);
  } catch {
    return summary;
  }

  const stream = createReadStream(filePath);
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  const seenMessageIds = new Set<string>();

  for await (const line of rl) {
    if (!line.trim()) continue;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }

    if (obj.type !== "assistant") continue;

    const message = obj.message as Record<string, unknown> | undefined;
    if (!message || typeof message !== "object") continue;
    const usage = message.usage as Record<string, unknown> | undefined;
    if (!usage) continue;

    const messageId = typeof message.id === "string" ? message.id : undefined;
    if (messageId) {
      if (seenMessageIds.has(messageId)) continue;
      seenMessageIds.add(messageId);
    }

    summary.inputTokens += pickNumber(usage.input_tokens);
    summary.cacheReadTokens += pickNumber(usage.cache_read_input_tokens);
    summary.cacheCreateTokens += pickNumber(usage.cache_creation_input_tokens);
    summary.outputTokens += pickNumber(usage.output_tokens);
    summary.assistantTurns += 1;

    const ts = typeof obj.timestamp === "string" ? obj.timestamp : undefined;
    if (ts) {
      if (!summary.firstTimestamp || ts < summary.firstTimestamp) summary.firstTimestamp = ts;
      if (!summary.lastTimestamp || ts > summary.lastTimestamp) summary.lastTimestamp = ts;
    }
  }

  return summary;
}

export async function summarizeAllSessionTokens(cutoffMs: number): Promise<AggregateTokenSummary> {
  const aggregate: AggregateTokenSummary = {
    sessions: [],
    totals: {
      sessions: 0,
      inputTokens: 0,
      cacheReadTokens: 0,
      cacheCreateTokens: 0,
      outputTokens: 0,
      assistantTurns: 0,
    },
  };

  if (!(await transcriptDirExists())) return aggregate;

  const projectDirs = await listProjectDirs();
  for (const projectDir of projectDirs) {
    const sessionFiles = await listSessionFiles(projectDir);
    for (const sessionFile of sessionFiles) {
      try {
        const stat = await fs.stat(sessionFile);
        if (stat.mtimeMs < cutoffMs) continue;
      } catch {
        continue;
      }
      const session = await summarizeSessionTokens(sessionFile);
      if (session.assistantTurns === 0) continue;
      aggregate.sessions.push(session);
      aggregate.totals.sessions += 1;
      aggregate.totals.inputTokens += session.inputTokens;
      aggregate.totals.cacheReadTokens += session.cacheReadTokens;
      aggregate.totals.cacheCreateTokens += session.cacheCreateTokens;
      aggregate.totals.outputTokens += session.outputTokens;
      aggregate.totals.assistantTurns += session.assistantTurns;
    }
  }

  aggregate.sessions.sort((a, b) => (b.lastTimestamp || "").localeCompare(a.lastTimestamp || ""));
  return aggregate;
}
