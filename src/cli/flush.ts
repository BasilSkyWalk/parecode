import * as fs from "node:fs/promises";
import * as path from "node:path";
import envPaths from "env-paths";
import { loadRollupWithInflight } from "../stats/tracker.js";

export async function flushCommand() {
  const dataDir = envPaths("parecode").data;
  const sessionDir = path.join(dataDir, "sessions");
  const rollupFile = path.join(sessionDir, "index.json");

  const { rollup, inflightCount } = await loadRollupWithInflight(sessionDir);

  if (inflightCount > 0) {
    try {
      await fs.writeFile(rollupFile, JSON.stringify(rollup, null, 2), "utf-8");
    } catch {}
  }

  process.stdout.write(`Flushed ${inflightCount} dangling session(s) to index.\n`);
}
