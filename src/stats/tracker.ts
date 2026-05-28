import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";
import envPaths from "env-paths";

export interface ToolCallRecord {
  toolCall: string;
  estimatedNativeTokens: number;
  actualTokens: number;
  callsBatched: number;
  error?: string;
}

export interface SessionRecord extends ToolCallRecord {
  timestamp: string;
  estimatedTokensSaved: number;
}

export interface SessionRollup {
  sessionId: string;
  startTime: string;
  endTime?: string;
  totalCalls: number;
  totalCallsBatched: number;
  totalEstimatedTokensSaved: number;
}

export async function loadRollupWithInflight(
  sessionDir: string,
): Promise<{ rollup: SessionRollup[]; inflightCount: number }> {
  const rollupFile = path.join(sessionDir, "index.json");

  let rollup: SessionRollup[] = [];
  try {
    const data = await fs.readFile(rollupFile, "utf-8");
    rollup = JSON.parse(data);
  } catch {}

  const knownIds = new Set(rollup.map((r) => r.sessionId));
  let inflightCount = 0;

  let files: string[] = [];
  try {
    files = await fs.readdir(sessionDir);
  } catch {
    return { rollup, inflightCount };
  }

  for (const file of files) {
    if (!file.endsWith(".jsonl")) continue;
    const sessionId = file.replace(".jsonl", "");
    if (knownIds.has(sessionId)) continue;

    let data = "";
    try {
      data = await fs.readFile(path.join(sessionDir, file), "utf-8");
    } catch {
      continue;
    }
    const lines = data.split(/\r?\n/).filter((line) => line.trim().length > 0);
    if (lines.length === 0) continue;

    let startTime = "";
    let endTime = "";
    let totalCalls = 0;
    let totalCallsBatched = 0;
    let totalEstimatedTokensSaved = 0;

    for (const line of lines) {
      try {
        const record = JSON.parse(line);
        totalCalls += 1;
        totalCallsBatched += record.callsBatched || 0;
        totalEstimatedTokensSaved += record.estimatedTokensSaved || 0;
        if (!startTime || record.timestamp < startTime) startTime = record.timestamp;
        if (!endTime || record.timestamp > endTime) endTime = record.timestamp;
      } catch {}
    }

    if (totalCalls > 0) {
      rollup.push({
        sessionId,
        startTime,
        endTime,
        totalCalls,
        totalCallsBatched,
        totalEstimatedTokensSaved,
      });
      inflightCount++;
    }
  }

  return { rollup, inflightCount };
}

export class Tracker {
  private logFile: string;
  private sessionId: string;
  private writeQueue: Promise<void> = Promise.resolve();
  private dataDir: string;
  private sessionDir: string;
  private rollupFile: string;

  private startTime: string;
  private totalCalls: number = 0;
  private totalCallsBatched: number = 0;
  private totalEstimatedTokensSaved: number = 0;
  private logErrorEmitted: boolean = false;

  constructor() {
    this.sessionId = crypto.randomUUID();
    this.startTime = new Date().toISOString();
    
    this.dataDir = envPaths("parecode").data;
    this.sessionDir = path.join(this.dataDir, "sessions");
    this.logFile = path.join(this.sessionDir, `${this.sessionId}.jsonl`);
    this.rollupFile = path.join(this.sessionDir, "index.json");
  }

  public async init(): Promise<void> {
    try {
      await fs.mkdir(this.sessionDir, { recursive: true });
      await fs.writeFile(this.logFile, "", { mode: 0o600 });
    } catch (err) {
      process.stderr.write(`parecode tracker init failed: ${err}\n`);
    }
  }

  public async record(record: ToolCallRecord): Promise<void> {
    this.totalCalls += 1;
    this.totalCallsBatched += record.callsBatched;
    const estimatedTokensSaved = record.estimatedNativeTokens - record.actualTokens;
    this.totalEstimatedTokensSaved += estimatedTokensSaved;

    const fullRecord: SessionRecord = {
      ...record,
      timestamp: new Date().toISOString(),
      estimatedTokensSaved,
    };

    const line = JSON.stringify(fullRecord) + os.EOL;

    this.writeQueue = this.writeQueue.then(async () => {
      try {
        await fs.appendFile(this.logFile, line, "utf-8");
      } catch (err) {
        if (!this.logErrorEmitted) {
          process.stderr.write(`parecode tracker write failed: ${err}\n`);
          this.logErrorEmitted = true;
        }
      }
    });

    return this.writeQueue;
  }

  public async finalize(): Promise<void> {
    await this.writeQueue;
    
    try {
      let rollup: SessionRollup[] = [];
      try {
        const data = await fs.readFile(this.rollupFile, "utf-8");
        rollup = JSON.parse(data);
      } catch {
      }

      rollup = rollup.filter((r) => r.sessionId !== this.sessionId);
      rollup.push({
        sessionId: this.sessionId,
        startTime: this.startTime,
        endTime: new Date().toISOString(),
        totalCalls: this.totalCalls,
        totalCallsBatched: this.totalCallsBatched,
        totalEstimatedTokensSaved: this.totalEstimatedTokensSaved,
      });

      await fs.writeFile(this.rollupFile, JSON.stringify(rollup, null, 2), "utf-8");
    } catch (err) {
      process.stderr.write(`parecode tracker finalize failed: ${err}\n`);
    }
  }

  public getSessionId(): string {
    return this.sessionId;
  }

  public getLogFile(): string {
    return this.logFile;
  }
}
