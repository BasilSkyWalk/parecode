import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

export interface StatRecord {
  toolCall: string;
  timestamp: string;
  pattern?: string;
  truncate?: string;
  filesMatched?: number;
  estimatedNativeTokens: number;
  actualTokens: number;
  isRefetch?: boolean;
}

export class Tracker {
  private logFile: string;
  private writeQueue: Promise<void> = Promise.resolve();
  // Simple heuristic for M0 re-fetch detection
  private recentSearches: Set<string> = new Set();

  constructor(logFile?: string) {
    // For M0, default to harness/session.jsonl in cwd if no path is given
    this.logFile = logFile || path.resolve(process.cwd(), "harness", "session.jsonl");
  }

  public async record(record: Omit<StatRecord, "timestamp" | "isRefetch">): Promise<void> {
    const isRefetch = record.truncate === "none" && record.pattern && this.recentSearches.has(record.pattern) ? true : false;
    
    if (record.truncate === "signatures" && record.pattern) {
      this.recentSearches.add(record.pattern);
    }

    const fullRecord: StatRecord = {
      ...record,
      timestamp: new Date().toISOString(),
      isRefetch,
    };

    const line = JSON.stringify(fullRecord) + os.EOL;

    // Serialize writes
    this.writeQueue = this.writeQueue.then(async () => {
      try {
        await fs.appendFile(this.logFile, line, "utf-8");
      } catch (err) {
        // Fallback for M0: ignore or write to stderr
        process.stderr.write("Failed to write stat: " + err + "\\n");
      }
    });

    return this.writeQueue;
  }
}
