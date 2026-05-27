import * as fs from "node:fs/promises";
import * as path from "node:path";
import envPaths from "env-paths";
import { SessionRollup } from "../stats/tracker.js";

export async function flushCommand() {
  const dataDir = envPaths("parecode").data;
  const sessionDir = path.join(dataDir, "sessions");
  const rollupFile = path.join(sessionDir, "index.json");

  let rollup: SessionRollup[] = [];
  try {
    const data = await fs.readFile(rollupFile, "utf-8");
    rollup = JSON.parse(data);
  } catch {}

  const knownIds = new Set(rollup.map((r) => r.sessionId));
  let flushedCount = 0;

  try {
    const files = await fs.readdir(sessionDir);
    for (const file of files) {
      if (file.endsWith(".jsonl")) {
        const sessionId = file.replace(".jsonl", "");
        if (!knownIds.has(sessionId)) {
          const filePath = path.join(sessionDir, file);
          let data = "";
          try {
            data = await fs.readFile(filePath, "utf-8");
          } catch {
            continue;
          }

          const lines = data.split(/\r?\n/).filter((line) => line.trim().length > 0);
          if (lines.length === 0) {
            continue;
          }

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

              if (!startTime || record.timestamp < startTime) {
                startTime = record.timestamp;
              }
              if (!endTime || record.timestamp > endTime) {
                endTime = record.timestamp;
              }
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
            flushedCount++;
          }
        }
      }
    }
  } catch {}

  if (flushedCount > 0) {
    try {
      await fs.writeFile(rollupFile, JSON.stringify(rollup, null, 2), "utf-8");
    } catch {}
  }

  process.stdout.write(`Flushed ${flushedCount} dangling session(s) to index.\n`);
}
