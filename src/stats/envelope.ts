import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import envPaths from "env-paths";

export interface EnvelopeRecord {
  timestamp: string;
  sessionId: string;
  toolCall: string;
  bytesReturned: number;
  durationMs: number;
  isError: boolean;
}

export class EnvelopeLogger {
  private logFile: string;
  private writeQueue: Promise<void> = Promise.resolve();
  private writeErrorEmitted: boolean = false;
  private sessionId: string;

  constructor(sessionId: string, dataDir?: string) {
    this.sessionId = sessionId;
    const resolvedDataDir = dataDir || envPaths("parecode").data;
    this.logFile = path.join(resolvedDataDir, "envelope.jsonl");
  }

  public async init(): Promise<void> {
    try {
      await fs.mkdir(path.dirname(this.logFile), { recursive: true });
      try {
        await fs.access(this.logFile);
      } catch {
        await fs.writeFile(this.logFile, "", { mode: 0o600 });
      }
    } catch (err) {
      process.stderr.write(`parecode envelope init failed: ${err}\n`);
    }
  }

  public record(entry: Omit<EnvelopeRecord, "timestamp" | "sessionId">): Promise<void> {
    const fullRecord: EnvelopeRecord = {
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
      ...entry,
    };
    const line = JSON.stringify(fullRecord) + os.EOL;

    this.writeQueue = this.writeQueue.then(async () => {
      try {
        await fs.appendFile(this.logFile, line, "utf-8");
      } catch (err) {
        if (!this.writeErrorEmitted) {
          process.stderr.write(`parecode envelope write failed: ${err}\n`);
          this.writeErrorEmitted = true;
        }
      }
    });

    return this.writeQueue;
  }

  public async flush(): Promise<void> {
    await this.writeQueue;
  }

  public getLogFile(): string {
    return this.logFile;
  }
}

export interface EnvelopeSummary {
  toolCall: string;
  calls: number;
  errors: number;
  totalBytes: number;
  totalDurationMs: number;
  meanBytes: number;
  meanDurationMs: number;
  p50Bytes: number;
  p95Bytes: number;
}

export async function summarizeEnvelopeLog(
  logFile: string,
  cutoffMs: number,
): Promise<EnvelopeSummary[]> {
  let data = "";
  try {
    data = await fs.readFile(logFile, "utf-8");
  } catch {
    return [];
  }

  const byTool = new Map<string, { bytes: number[]; durations: number[]; errors: number }>();

  for (const line of data.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let rec: EnvelopeRecord;
    try {
      rec = JSON.parse(line) as EnvelopeRecord;
    } catch {
      continue;
    }
    if (new Date(rec.timestamp).getTime() < cutoffMs) continue;

    let bucket = byTool.get(rec.toolCall);
    if (!bucket) {
      bucket = { bytes: [], durations: [], errors: 0 };
      byTool.set(rec.toolCall, bucket);
    }
    bucket.bytes.push(rec.bytesReturned);
    bucket.durations.push(rec.durationMs);
    if (rec.isError) bucket.errors++;
  }

  const summaries: EnvelopeSummary[] = [];
  for (const [toolCall, bucket] of byTool) {
    const sortedBytes = [...bucket.bytes].sort((a, b) => a - b);
    const totalBytes = bucket.bytes.reduce((s, n) => s + n, 0);
    const totalDurationMs = bucket.durations.reduce((s, n) => s + n, 0);
    const calls = bucket.bytes.length;
    summaries.push({
      toolCall,
      calls,
      errors: bucket.errors,
      totalBytes,
      totalDurationMs,
      meanBytes: calls > 0 ? Math.round(totalBytes / calls) : 0,
      meanDurationMs: calls > 0 ? Math.round(totalDurationMs / calls) : 0,
      p50Bytes: percentile(sortedBytes, 0.5),
      p95Bytes: percentile(sortedBytes, 0.95),
    });
  }

  summaries.sort((a, b) => b.totalBytes - a.totalBytes);
  return summaries;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx];
}
