import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  listProjectDirs,
  listSessionFiles,
  decodeProjectName,
  transcriptDirExists,
} from "../infra/claudeCodeTranscripts.js";
import { parseTranscriptFile, TranscriptRecord } from "./transcriptParser.js";
import { classifyToolCalls, CallClass } from "./classifier.js";
import { estimateTokens, estimateSearchEnvelopeTokens } from "./estimator.js";

export interface RetroactiveScanResult {
  sessions: number;
  toolCalls: number;
  callsBatched: number;
  estimatedTokensSaved: number;
  windowsDedupedAcrossCalls?: number;
  spillsUnconsumed?: number;
}

export async function runRetroactiveScan(cutoffMs: number, snapshotDir?: string, includeContent = false): Promise<RetroactiveScanResult> {
  const result: RetroactiveScanResult = {
    sessions: 0,
    toolCalls: 0,
    callsBatched: 0,
    estimatedTokensSaved: 0,
    windowsDedupedAcrossCalls: 0,
    spillsUnconsumed: 0,
  };

  if (!(await transcriptDirExists())) {
    return result;
  }

  const projectDirs = await listProjectDirs();

  for (const projectDir of projectDirs) {
    const sessionFiles = await listSessionFiles(projectDir);

    for (const sessionFile of sessionFiles) {
      try {
        const stat = await fs.stat(sessionFile);
        if (stat.mtimeMs < cutoffMs) {
          continue;
        }
      } catch {
        continue;
      }

      const records = await parseTranscriptFile(sessionFile, includeContent);
      if (records.length === 0) continue;

      result.sessions++;
      const classes = classifyToolCalls(records);

      let currentSearchGroup: Array<{ content?: string; estimatedTokens?: number }> = [];

      for (let i = 0; i < records.length; i++) {
        const record = records[i];
        const cls = classes[i];

        if (cls === null) continue;

        result.toolCalls++;

        if (cls === "replaceable_search") {
          const outputTokens = record.tokens?.output || 0;
          const actualTokens = outputTokens;

          const parecodeEst = estimateSearchEnvelopeTokens([{ estimatedTokens: actualTokens }]);

          if (actualTokens > parecodeEst) {
            result.estimatedTokensSaved += (actualTokens - parecodeEst);
          }
        } else if (cls === "replaceable_edit") {
          const inputTokens = record.tokens?.input || 0;
          result.estimatedTokensSaved += Math.floor(inputTokens * 0.3);
        } else if (cls === "read_followups") {
          const inputTokens = record.tokens?.input || 0;
          const outputTokens = record.tokens?.output || 0;
          result.estimatedTokensSaved += (inputTokens + outputTokens);
        }
      }
    }
  }

  if (snapshotDir) {
    try {
      await fs.mkdir(snapshotDir, { recursive: true });
      const filename = path.join(snapshotDir, `${Date.now()}.json`);
      await fs.writeFile(filename, JSON.stringify(result, null, 2) + "\n", { mode: 0o600 });
    } catch {
    }
  }

  return result;
}
