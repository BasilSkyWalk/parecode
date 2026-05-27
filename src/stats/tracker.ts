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
