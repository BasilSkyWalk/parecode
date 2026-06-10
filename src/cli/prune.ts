import envPaths from "env-paths";
import { pruneSessions } from "../stats/retention.js";

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

  const deletedCount = await pruneSessions(envPaths("parecode").data, days);
  process.stdout.write(`Pruned ${deletedCount} session(s).\n`);
}
