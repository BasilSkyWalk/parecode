import * as path from "node:path";
import envPaths from "env-paths";
import { summarizeEnvelopeLog } from "../stats/envelope.js";
import { parseDurationFlag } from "./durationFlag.js";

export async function envelopeCommand(args: string[]) {
  let sinceStr = "7d";
  let outputJson = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--since" && i + 1 < args.length) {
      sinceStr = args[i + 1];
      i++;
    } else if (args[i] === "--json") {
      outputJson = true;
    } else if (/^(\d+)(d|h|m|s)$/.test(args[i])) {
      sinceStr = args[i];
    }
  }

  const cutoff = parseDurationFlag(sinceStr);
  if (cutoff === null) {
    process.stderr.write(`Invalid --since value: ${sinceStr}. Use format like '7d', '24h', '30m', or '90s'.\n`);
    process.exit(1);
  }

  const dataDir = process.env.PARECODE_DATA_DIR || envPaths("parecode").data;
  const logFile = path.join(dataDir, "envelope.jsonl");

  const summaries = await summarizeEnvelopeLog(logFile, cutoff);

  if (outputJson) {
    process.stdout.write(JSON.stringify({ since: sinceStr, perTool: summaries }, null, 2) + "\n");
    return;
  }

  process.stdout.write(`Parecode tool envelope — last ${sinceStr}\n`);
  process.stdout.write(`──────────────────────────────────\n`);
  if (summaries.length === 0) {
    process.stdout.write(`No calls recorded.\n`);
    return;
  }

  process.stdout.write(`  ${"Tool".padEnd(18)} ${"calls".padStart(7)} ${"err".padStart(5)} ${"meanB".padStart(8)} ${"p50B".padStart(8)} ${"p95B".padStart(8)} ${"meanMs".padStart(8)}\n`);
  for (const s of summaries) {
    process.stdout.write(
      `  ${s.toolCall.padEnd(18)} ${s.calls.toLocaleString().padStart(7)} ${s.errors.toLocaleString().padStart(5)} ${s.meanBytes.toLocaleString().padStart(8)} ${s.p50Bytes.toLocaleString().padStart(8)} ${s.p95Bytes.toLocaleString().padStart(8)} ${s.meanDurationMs.toLocaleString().padStart(8)}\n`,
    );
  }
}
