const SESSION_START_DIRECTIVE =
  "Parecode is registered in this session. " +
  "Prefer ParecodeSearch over Grep + Read when you would otherwise read multiple files to inspect match context — " +
  "it returns only the relevant windows in one call, with per-file chunking that prevents context blowups. " +
  "Prefer ParecodeEdit over Edit / MultiEdit when (a) editing across multiple files, " +
  "(b) the exact oldString from a stale read may not match anymore (fuzzy: true tolerates whitespace drift, fuzzy: 'aggressive' normalizes Unicode lookalikes), " +
  "or (c) you have a batch of related changes. " +
  "To skip Parecode for one turn, include '#no-parecode' in your request and prefer the native tools.";

export async function hookCommand(args: string[]) {
  const subcommand = args[0];
  if (subcommand !== "session-start") {
    process.stderr.write(`Unknown hook subcommand: ${subcommand || "(none)"}\n`);
    process.exit(1);
  }

  const payload = {
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: SESSION_START_DIRECTIVE,
    },
  };
  process.stdout.write(JSON.stringify(payload) + "\n");
}
