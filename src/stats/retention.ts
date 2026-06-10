import * as fs from "node:fs/promises";
import * as path from "node:path";
import { SessionRollup } from "./tracker.js";

export const SESSION_RETENTION_DAYS = 30;
export const ENVELOPE_MAX_BYTES = 5 * 1024 * 1024;
export const ENVELOPE_KEEP_BYTES = 2.5 * 1024 * 1024;

export async function pruneSessions(dataDir: string, days: number): Promise<number> {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const sessionDir = path.join(dataDir, "sessions");
  const rollupFile = path.join(sessionDir, "index.json");

  let rollup: SessionRollup[] = [];
  try {
    rollup = JSON.parse(await fs.readFile(rollupFile, "utf-8"));
  } catch {}

  const toKeep = rollup.filter((s) => new Date(s.startTime).getTime() >= cutoff);
  if (toKeep.length !== rollup.length) {
    try {
      await fs.writeFile(rollupFile, JSON.stringify(toKeep, null, 2), "utf-8");
    } catch {}
  }

  let deletedCount = 0;
  let files: string[] = [];
  try {
    files = await fs.readdir(sessionDir);
  } catch {
    return 0;
  }
  for (const file of files) {
    if (!file.endsWith(".jsonl") && !(file.endsWith(".json") && file !== "index.json")) continue;
    const filePath = path.join(sessionDir, file);
    try {
      const stats = await fs.stat(filePath);
      if (stats.mtimeMs < cutoff) {
        await fs.unlink(filePath);
        deletedCount++;
      }
    } catch {}
  }
  return deletedCount;
}

export async function truncateEnvelope(dataDir: string): Promise<boolean> {
  const envelopeFile = path.join(dataDir, "envelope.jsonl");

  let size = 0;
  try {
    size = (await fs.stat(envelopeFile)).size;
  } catch {
    return false;
  }
  if (size <= ENVELOPE_MAX_BYTES) return false;

  const content = await fs.readFile(envelopeFile, "utf-8");
  let cut = content.length - ENVELOPE_KEEP_BYTES;
  const nextLineBreak = content.indexOf("\n", cut);
  if (nextLineBreak === -1) return false;
  cut = nextLineBreak + 1;

  const tmpFile = `${envelopeFile}.${process.pid}.tmp`;
  await fs.writeFile(tmpFile, content.substring(cut), "utf-8");
  await fs.rename(tmpFile, envelopeFile);
  return true;
}

export async function runStartupCleanup(
  dataDir: string,
  log?: (msg: string, meta?: object) => void
): Promise<void> {
  try {
    const deleted = await pruneSessions(dataDir, SESSION_RETENTION_DAYS);
    const truncated = await truncateEnvelope(dataDir);
    if ((deleted > 0 || truncated) && log) {
      log("startup_cleanup", { sessionsDeleted: deleted, envelopeTruncated: truncated });
    }
  } catch (err) {
    if (log) log("startup_cleanup_failed", { error: String(err) });
  }
}
