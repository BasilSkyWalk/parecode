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
}

export async function runRetroactiveScan(cutoffMs: number): Promise<RetroactiveScanResult> {
  const result: RetroactiveScanResult = {
    sessions: 0,
    toolCalls: 0,
    callsBatched: 0,
    estimatedTokensSaved: 0,
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

      const records = await parseTranscriptFile(sessionFile);
      if (records.length === 0) continue;

      result.sessions++;
      const classes = classifyToolCalls(records);

      let currentSearchGroup: Array<{ content?: string; estimatedTokens?: number }> = [];

      for (let i = 0; i < records.length; i++) {
        const record = records[i];
        const cls = classes[i];

        if (cls === null) continue; // not a tool call

        result.toolCalls++;

        if (cls === "replaceable_search") {
          const inputTokens = record.tokens?.input || estimateTokens(JSON.stringify(record.input || {}));
          const outputTokens = record.tokens?.output || 0; // we don't know the output, but Claude records it.
          const actualTokens = outputTokens; // native search token cost is mostly output

          // For the batched search tokens, we need to collect results.
          // In a retroactive scan, we don't have the file contents.
          // We can only use the actualTokens as the upper bound, and estimate parecode tokens using the output size.
          // If we don't have content, we just use the actualTokens as the 'content' token equivalent and 
          // add the envelope overhead. But wait, `estimateSearchEnvelopeTokens` takes `matches`.
          // If we just pass a mock match with `estimatedTokens: actualTokens`, it adds envelope overhead.
          const parecodeEst = estimateSearchEnvelopeTokens([{ estimatedTokens: actualTokens }]);
          
          if (actualTokens > parecodeEst) {
            result.estimatedTokensSaved += (actualTokens - parecodeEst);
          }
        } else if (cls === "replaceable_edit") {
          // Edits: parecode edit sends the file diff.
          // Actually, edit token savings is mostly context windows.
          // To keep it simple, we use the input token difference.
          const inputTokens = record.tokens?.input || 0;
          // Let's just assume 50% savings for edits based on typical context omission, 
          // or use a flat estimation if we don't have the exact file stats.
          result.estimatedTokensSaved += Math.floor(inputTokens * 0.3); // Rough heuristic
        } else if (cls === "read_followups") {
          // Read followups are entirely saved by parecode search!
          const inputTokens = record.tokens?.input || 0;
          const outputTokens = record.tokens?.output || 0;
          result.estimatedTokensSaved += (inputTokens + outputTokens);
        }
      }
    }
  }

  return result;
}
