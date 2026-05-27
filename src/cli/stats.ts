import * as fs from "node:fs/promises";
import * as path from "node:path";
import envPaths from "env-paths";
import { SessionRollup } from "../stats/tracker.js";

export async function statsCommand(args: string[]) {
  let sinceStr = "7d";
  let outputJson = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--since" && i + 1 < args.length) {
      sinceStr = args[i + 1];
      i++;
    } else if (args[i] === "--json") {
      outputJson = true;
    }
  }

  const match = sinceStr.match(/^(\d+)(d|h)$/);
  if (!match) {
    process.stderr.write(`Invalid --since value: ${sinceStr}. Use format like '7d' or '24h'.\n`);
    process.exit(1);
  }

  const value = parseInt(match[1], 10);
  const unit = match[2];
  const ms = value * (unit === "d" ? 24 * 60 * 60 * 1000 : 60 * 60 * 1000);
  const cutoff = Date.now() - ms;

  const dataDir = envPaths("parecode").data;
  const rollupFile = path.join(dataDir, "sessions", "index.json");

  let rollup: SessionRollup[] = [];
  try {
    const data = await fs.readFile(rollupFile, "utf-8");
    rollup = JSON.parse(data);
  } catch (err) {
  }

  const filtered = rollup.filter((s) => new Date(s.startTime).getTime() >= cutoff);

  let totalSessions = filtered.length;
  let totalCalls = 0;
  let totalCallsBatched = 0;
  let totalEstimatedTokensSaved = 0;

  for (const s of filtered) {
    totalCalls += s.totalCalls || 0;
    totalCallsBatched += s.totalCallsBatched || 0;
    totalEstimatedTokensSaved += s.totalEstimatedTokensSaved || 0;
  }

  if (outputJson) {
    process.stdout.write(JSON.stringify({
      sessions: totalSessions,
      toolCalls: totalCalls,
      callsBatched: totalCallsBatched,
      estimatedTokensSaved: totalEstimatedTokensSaved,
      since: sinceStr
    }, null, 2) + "\n");
  } else {
    process.stdout.write(`Parecode — last ${sinceStr}\n`);
    process.stdout.write(`─────────────────────\n`);
    process.stdout.write(`Sessions:               ${totalSessions.toLocaleString().padStart(6)}\n`);
    process.stdout.write(`Tool calls:             ${totalCalls.toLocaleString().padStart(6)}\n`);
    process.stdout.write(`Calls batched (est):    ${totalCallsBatched.toLocaleString().padStart(6)}\n`);
    process.stdout.write(`Tokens saved (est):     ${totalEstimatedTokensSaved.toLocaleString().padStart(6)}\n`);
  }
}
