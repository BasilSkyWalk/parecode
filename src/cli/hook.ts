const SESSION_START_DIRECTIVE =
  "Parecode is registered in this session. " +
  "Prefer ParecodeSearch over Grep + Read when you would otherwise read multiple files to inspect match context — " +
  "it returns only the relevant windows in one call, with per-file chunking that prevents context blowups. " +
  "Prefer ParecodeEdit over Edit / MultiEdit when (a) editing across multiple files, " +
  "(b) the exact oldString from a stale read may not match anymore (fuzzy: true tolerates whitespace drift, fuzzy: 'aggressive' normalizes Unicode lookalikes), " +
  "or (c) you have a batch of related changes. " +
  "To skip Parecode for one turn, include '#no-parecode' in your request and prefer the native tools.";

const GREP_REDIRECT_REASON =
  "Use ParecodeSearch instead — it accepts the same regex pattern, returns matches with surrounding context windows in a single call, and avoids the separate Read steps that follow Grep. " +
  "Call ParecodeSearch with { pattern, paths? } using your current regex.";

const GLOB_REDIRECT_REASON =
  "Use ParecodeSearch with the same pattern as your regex source — it returns matched files with context in one call. " +
  "If you only need a file list, ParecodeSearch still wins (its result names every file with matches).";

interface PreToolUseInput {
  tool_name?: string;
  hook_event_name?: string;
}

async function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    if (process.stdin.isTTY) {
      resolve("");
      return;
    }
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk) => { data += chunk; });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", () => resolve(data));
  });
}

function emitAllow(): void {
  const payload = {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
    },
  };
  process.stdout.write(JSON.stringify(payload) + "\n");
}

function emitDeny(reason: string): void {
  const payload = {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  };
  process.stdout.write(JSON.stringify(payload) + "\n");
}

async function sessionStart(): Promise<void> {
  const payload = {
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: SESSION_START_DIRECTIVE,
    },
  };
  process.stdout.write(JSON.stringify(payload) + "\n");
}

async function preToolUse(): Promise<void> {
  const raw = await readStdin();
  let input: PreToolUseInput = {};
  if (raw.trim()) {
    try {
      input = JSON.parse(raw);
    } catch {
      emitAllow();
      return;
    }
  }
  const toolName = input.tool_name;
  if (toolName === "Grep") {
    emitDeny(GREP_REDIRECT_REASON);
    return;
  }
  if (toolName === "Glob") {
    emitDeny(GLOB_REDIRECT_REASON);
    return;
  }
  emitAllow();
}

export async function hookCommand(args: string[]) {
  const subcommand = args[0];
  if (subcommand === "session-start") {
    await sessionStart();
    return;
  }
  if (subcommand === "pre-tool-use") {
    await preToolUse();
    return;
  }
  process.stderr.write(`Unknown hook subcommand: ${subcommand || "(none)"}\n`);
  process.exit(1);
}
