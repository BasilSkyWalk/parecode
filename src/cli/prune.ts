import * as fs from "node:fs/promises";
import * as path from "node:path";
import envPaths from "env-paths";
import { SessionRollup } from "../stats/tracker.js";

export async function pruneCommand(args: string[]) {
  if (args.length === 0) {
    process.stderr.write("Usage: parecode prune <days>\n");
    process.exit(1);
  }

  const days = parseInt(args[0], 10);
  if (isNaN(days) || days < 0) {
    process.stderr.write(`Invalid days argument: ${args[0]}\n`);
    process.exit(1);
  }

  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const dataDir = envPaths("parecode").data;
  const sessionDir = path.join(dataDir, "sessions");
  const rollupFile = path.join(sessionDir, "index.json");

  let rollup: SessionRollup[] = [];
  try {
    const data = await fs.readFile(rollupFile, "utf-8");
    rollup = JSON.parse(data);
  } catch {}

  const toKeep: SessionRollup[] = [];
  for (const session of rollup) {
    if (new Date(session.startTime).getTime() >= cutoff) {
      toKeep.push(session);
    }
  }

  if (toKeep.length !== rollup.length) {
    try {
      await fs.writeFile(rollupFile, JSON.stringify(toKeep, null, 2), "utf-8");
    } catch {}
  }

  let deletedCount = 0;
  try {
    const files = await fs.readdir(sessionDir);
    for (const file of files) {
      if (file.endsWith(".jsonl")) {
        const filePath = path.join(sessionDir, file);
        try {
          const stats = await fs.stat(filePath);
          if (stats.mtimeMs < cutoff) {
            await fs.unlink(filePath);
            deletedCount++;
          }
        } catch {}
      }
    }
  } catch {}

  process.stdout.write(`Pruned ${deletedCount} session(s).\n`);
}
