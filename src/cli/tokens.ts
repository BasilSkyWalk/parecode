import { summarizeAllSessionTokens } from "../stats/sessionTokens.js";
import { parseDurationFlag } from "./durationFlag.js";

export async function tokensCommand(args: string[]) {
  let sinceStr = "7d";
  let outputJson = false;
  let limit = 20;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--since" && i + 1 < args.length) {
      sinceStr = args[i + 1];
      i++;
    } else if (args[i] === "--json") {
      outputJson = true;
    } else if (args[i] === "--limit" && i + 1 < args.length) {
      const n = parseInt(args[i + 1], 10);
      if (!isNaN(n) && n > 0) limit = n;
      i++;
    } else if (/^(\d+)(d|h|m|s)$/.test(args[i])) {
      sinceStr = args[i];
    }
  }

  const cutoff = parseDurationFlag(sinceStr);
  if (cutoff === null) {
    process.stderr.write(`Invalid --since value: ${sinceStr}. Use format like '7d', '24h', '30m', or '90s'.\n`);
    process.exit(1);
  }

  const result = await summarizeAllSessionTokens(cutoff);

  if (outputJson) {
    process.stdout.write(JSON.stringify({
      since: sinceStr,
      ...result,
    }, null, 2) + "\n");
    return;
  }

  const t = result.totals;
  process.stdout.write(`Parecode session tokens — last ${sinceStr}\n`);
  process.stdout.write(`──────────────────────────────────\n`);
  process.stdout.write(`Sessions:           ${t.sessions.toLocaleString().padStart(12)}\n`);
  process.stdout.write(`Assistant turns:    ${t.assistantTurns.toLocaleString().padStart(12)}\n`);
  process.stdout.write(`Input tokens:       ${t.inputTokens.toLocaleString().padStart(12)}\n`);
  process.stdout.write(`Cache read:         ${t.cacheReadTokens.toLocaleString().padStart(12)}\n`);
  process.stdout.write(`Cache create:       ${t.cacheCreateTokens.toLocaleString().padStart(12)}\n`);
  process.stdout.write(`Output tokens:      ${t.outputTokens.toLocaleString().padStart(12)}\n`);
  process.stdout.write(`Total tokens:       ${(t.inputTokens + t.cacheReadTokens + t.cacheCreateTokens + t.outputTokens).toLocaleString().padStart(12)}\n`);

  if (result.sessions.length === 0) return;

  process.stdout.write(`\nRecent sessions (top ${Math.min(limit, result.sessions.length)} by last activity):\n`);
  process.stdout.write(`──────────────────────────────────\n`);
  for (const s of result.sessions.slice(0, limit)) {
    const total = s.inputTokens + s.cacheReadTokens + s.cacheCreateTokens + s.outputTokens;
    const when = s.lastTimestamp ? s.lastTimestamp.slice(0, 19).replace("T", " ") : "—";
    process.stdout.write(`  ${when}  ${s.sessionId.slice(0, 8)}  ${total.toLocaleString().padStart(12)} tok  (${s.assistantTurns} turns)\n`);
  }
}
