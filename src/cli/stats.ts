import * as path from "node:path";
import envPaths from "env-paths";
import { loadRollupWithInflight } from "../stats/tracker.js";
import { runRetroactiveScan } from "../stats/retroactiveScan.js";

export async function statsCommand(args: string[]) {
  let sinceStr = "7d";
  let outputJson = false;
  let retroactive = false;

  const durationPattern = /^(\d+)(d|h|m|s)$/;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--since" && i + 1 < args.length) {
      sinceStr = args[i + 1];
      i++;
    } else if (args[i] === "--json") {
      outputJson = true;
    } else if (args[i] === "--retroactive") {
      retroactive = true;
      // Default to 30d if --retroactive is used and --since hasn't been parsed yet.
      // We will re-apply the 30d default below if sinceStr is still 7d.
    } else if (durationPattern.test(args[i])) {
      sinceStr = args[i];
    }
  }

  if (retroactive && !args.includes("--since")) {
    sinceStr = "30d";
  }

  const match = sinceStr.match(/^(\d+)(d|h|m|s)$/);
  if (!match) {
    process.stderr.write(`Invalid --since value: ${sinceStr}. Use format like '7d', '24h', '30m', or '90s'.\n`);
    process.exit(1);
  }

  const value = parseInt(match[1], 10);
  const unit = match[2];
  const unitMs: Record<string, number> = {
    d: 24 * 60 * 60 * 1000,
    h: 60 * 60 * 1000,
    m: 60 * 1000,
    s: 1000,
  };
  const ms = value * unitMs[unit];
  const cutoff = Date.now() - ms;

  let totalSessions = 0;
  let totalCalls = 0;
  let totalCallsBatched = 0;
  let totalEstimatedTokensSaved = 0;

  if (retroactive) {
    const retroResult = await runRetroactiveScan(cutoff);
    totalSessions = retroResult.sessions;
    totalCalls = retroResult.toolCalls;
    totalCallsBatched = retroResult.callsBatched;
    totalEstimatedTokensSaved = retroResult.estimatedTokensSaved;
  } else {
    const dataDir = process.env.PARECODE_DATA_DIR || envPaths("parecode").data;
    const sessionDir = path.join(dataDir, "sessions");

    const { rollup } = await loadRollupWithInflight(sessionDir);

    const filtered = rollup.filter((s) => new Date(s.startTime).getTime() >= cutoff);

    totalSessions = filtered.length;
    for (const s of filtered) {
      totalCalls += s.totalCalls || 0;
      totalCallsBatched += s.totalCallsBatched || 0;
      totalEstimatedTokensSaved += s.totalEstimatedTokensSaved || 0;
    }
  }

  if (outputJson) {
    process.stdout.write(JSON.stringify({
      sessions: totalSessions,
      toolCalls: totalCalls,
      callsBatched: totalCallsBatched,
      estimatedTokensSaved: totalEstimatedTokensSaved,
      since: sinceStr,
      ...(retroactive ? { retroactive: true } : {})
    }, null, 2) + "\n");
  } else {
    process.stdout.write(`Parecode — last ${sinceStr}${retroactive ? " (retroactive scan)" : ""}\n`);
    process.stdout.write(`─────────────────────\n`);
    process.stdout.write(`Sessions:               ${totalSessions.toLocaleString().padStart(6)}\n`);
    process.stdout.write(`Tool calls:             ${totalCalls.toLocaleString().padStart(6)}\n`);
    process.stdout.write(`Calls batched (est):    ${totalCallsBatched.toLocaleString().padStart(6)}\n`);
    process.stdout.write(`Tokens saved (est):     ${totalEstimatedTokensSaved.toLocaleString().padStart(6)}\n`);
    if (retroactive) {
      process.stdout.write(`\n* Note: Retroactive savings are estimated, not measured.\n`);
    }
  }
}
