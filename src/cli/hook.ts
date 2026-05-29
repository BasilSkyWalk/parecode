const SESSION_START_DIRECTIVE =
  "Parecode is registered in this session. Two rules:\n\n" +
  "1. ParecodeSearch over Grep + Read — including shell grep and same-file re-reads.\n" +
  "   Use ParecodeSearch whenever you want to find code AND see its context. Concretely, ParecodeSearch is the right tool when ANY of these is true:\n" +
  "   (a) you would call Grep / Glob and then Read one or more matched files for context,\n" +
  "   (b) you are about to run `grep`, `egrep`, `fgrep`, `rg`, or `ripgrep` via the Bash tool — those are searches too, and ParecodeSearch accepts the same regex,\n" +
  "   (c) you have Read the same file more than once this turn at different line ranges — that is the search-then-read pattern in disguise; replace those Reads with one ParecodeSearch whose pattern OR'es the symbols you were looking for,\n" +
  "   (d) you are reading a file specifically to find a few symbols — pass those symbols as the ParecodeSearch pattern instead and skip the full Read.\n" +
  "   ParecodeSearch returns only the relevant windows in a single call, with per-file chunking that prevents context blowups.\n\n" +
  "2. ParecodeEdit over Edit / MultiEdit whenever ANY of the following is true:\n" +
  "   (a) you are about to make 2 or more edits to the same file (even to a markdown / spec / config file — batching is not a code-only rule),\n" +
  "   (b) you are editing across multiple files,\n" +
  "   (c) your oldString was captured from a Read that happened before other edits, so whitespace or line numbers may have drifted (use fuzzy: true; fuzzy: 'aggressive' also normalizes Unicode lookalikes),\n" +
  "   (d) the changes are logically one revision and should land atomically (ParecodeEdit applies all-or-nothing; a sequence of Edit calls can leave the file half-updated if one fails).\n" +
  "   Default: if you find yourself planning a second Edit to a file you already edited this turn, the first Edit was the wrong tool — use ParecodeEdit.\n\n" +
  "Escape hatch: include '#no-parecode' anywhere in your message to skip both rules for that turn and prefer the native tools.";

const GREP_REDIRECT_REASON =
  "Use ParecodeSearch instead — it accepts the same regex pattern, returns matches with surrounding context windows in a single call, and avoids the separate Read steps that follow Grep. " +
  "Call ParecodeSearch with { pattern, paths? } using your current regex.";

const GLOB_REDIRECT_REASON =
  "Use ParecodeSearch with the same pattern as your regex source — it returns matched files with context in one call. " +
  "If you only need a file list, ParecodeSearch still wins (its result names every file with matches).";

const BASH_SEARCH_REDIRECT_REASON =
  "Use ParecodeSearch instead of shell grep/rg — it accepts the same regex pattern (extended regex), returns matches with surrounding context windows in a single call, and respects ignore files. " +
  "Translate your command: the search pattern becomes ParecodeSearch's `pattern`; the path(s) become `paths`. " +
  "If you genuinely need shell grep/rg for non-search use (e.g. piping into another command), include '#no-parecode' in your next message to bypass this hook for one turn.";

const BASH_SEARCH_COMMAND_RE = /(^|[;&|`(]|\$\()\s*(grep|egrep|fgrep|rg|ripgrep)(\s|$)/;

interface PreToolUseInput {
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  hook_event_name?: string;
}

function isBashSearchCommand(input: PreToolUseInput): boolean {
  if (input.tool_name !== "Bash") return false;
  const cmd = input.tool_input?.["command"];
  if (typeof cmd !== "string") return false;
  return BASH_SEARCH_COMMAND_RE.test(cmd);
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
  if (isBashSearchCommand(input)) {
    emitDeny(BASH_SEARCH_REDIRECT_REASON);
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
