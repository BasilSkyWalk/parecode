import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { spawnCommand, resolveCommand } from "../infra/spawn.js";

interface HookEntry {
  matcher?: string;
  hooks?: Array<{ type: string; command: string }>;
}

interface ClaudeSettings {
  hooks?: {
    SessionStart?: HookEntry[];
    PreToolUse?: HookEntry[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

function userConfigDir(): string {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
}

function resolveSettingsPath(scope: string): string {
  if (scope === "user") {
    return path.join(userConfigDir(), "settings.json");
  }
  if (scope === "local") {
    return path.join(process.cwd(), ".claude", "settings.local.json");
  }
  return path.join(process.cwd(), ".claude", "settings.json");
}

async function readSettings(filepath: string): Promise<ClaudeSettings> {
  try {
    const raw = await fs.readFile(filepath, "utf-8");
    return JSON.parse(raw) as ClaudeSettings;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw err;
  }
}

async function writeSettings(filepath: string, settings: ClaudeSettings): Promise<void> {
  await fs.mkdir(path.dirname(filepath), { recursive: true });
  const tmp = `${filepath}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(settings, null, 2) + "\n", "utf-8");
  await fs.rename(tmp, filepath);
}

function sessionStartCommandFor(useLinked: boolean): string {
  return useLinked ? "parecode hook session-start" : "npx parecode hook session-start";
}

function preToolUseCommandFor(useLinked: boolean): string {
  return useLinked ? "parecode hook pre-tool-use" : "npx parecode hook pre-tool-use";
}

function matchesParecodeHook(command: string): boolean {
  return /^(npx\s+)?parecode\s+hook\s+(session-start|pre-tool-use)$/.test(command);
}

function matchesSessionStart(command: string): boolean {
  return /^(npx\s+)?parecode\s+hook\s+session-start$/.test(command);
}

function matchesPreToolUse(command: string): boolean {
  return /^(npx\s+)?parecode\s+hook\s+pre-tool-use$/.test(command);
}

async function installHook(scope: string, useLinked: boolean): Promise<"installed" | "already-present"> {
  const filepath = resolveSettingsPath(scope);
  const settings = await readSettings(filepath);
  if (!settings.hooks) settings.hooks = {};
  if (!settings.hooks.SessionStart) settings.hooks.SessionStart = [];

  const desiredCommand = sessionStartCommandFor(useLinked);
  for (const entry of settings.hooks.SessionStart) {
    for (const h of entry.hooks ?? []) {
      if (h.type === "command" && matchesSessionStart(h.command)) {
        return "already-present";
      }
    }
  }

  settings.hooks.SessionStart.push({
    hooks: [{ type: "command", command: desiredCommand }],
  });
  await writeSettings(filepath, settings);
  return "installed";
}

async function installAggressiveHook(scope: string, useLinked: boolean): Promise<"installed" | "already-present"> {
  const filepath = resolveSettingsPath(scope);
  const settings = await readSettings(filepath);
  if (!settings.hooks) settings.hooks = {};
  if (!settings.hooks.PreToolUse) settings.hooks.PreToolUse = [];

  const desiredCommand = preToolUseCommandFor(useLinked);
  for (const entry of settings.hooks.PreToolUse) {
    for (const h of entry.hooks ?? []) {
      if (h.type === "command" && matchesPreToolUse(h.command)) {
        return "already-present";
      }
    }
  }

  settings.hooks.PreToolUse.push({
    matcher: "Grep|Glob",
    hooks: [{ type: "command", command: desiredCommand }],
  });
  await writeSettings(filepath, settings);
  return "installed";
}

async function removeHook(scope: string): Promise<"removed" | "not-present"> {
  const filepath = resolveSettingsPath(scope);
  const settings = await readSettings(filepath);
  if (!settings.hooks) return "not-present";

  let changed = false;

  for (const eventName of ["SessionStart", "PreToolUse"] as const) {
    const entries = settings.hooks[eventName];
    if (!entries) continue;
    const filtered: HookEntry[] = [];
    for (const entry of entries) {
      const remaining = (entry.hooks ?? []).filter(
        (h) => !(h.type === "command" && matchesParecodeHook(h.command)),
      );
      if (remaining.length !== (entry.hooks ?? []).length) changed = true;
      if (remaining.length > 0) {
        filtered.push({ ...entry, hooks: remaining });
      }
    }
    if (filtered.length > 0) {
      settings.hooks[eventName] = filtered;
    } else {
      delete settings.hooks[eventName];
    }
  }

  if (!changed) return "not-present";

  if (settings.hooks && Object.keys(settings.hooks).length === 0) delete settings.hooks;
  await writeSettings(filepath, settings);
  return "removed";
}

export async function initCommand(args: string[]) {
  let scope = "user";
  let printOnly = false;
  let useLinked = false;
  let withHook = false;
  let aggressiveHook = false;
  let removeHookOnly = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--scope" && i + 1 < args.length) {
      scope = args[i + 1];
      i++;
    } else if (args[i] === "--print") {
      printOnly = true;
    } else if (args[i] === "--linked") {
      useLinked = true;
    } else if (args[i] === "--with-hook") {
      withHook = true;
    } else if (args[i] === "--aggressive-hook") {
      withHook = true;
      aggressiveHook = true;
    } else if (args[i] === "--remove-hook") {
      removeHookOnly = true;
    }
  }

  if (!["user", "local", "project"].includes(scope)) {
    process.stderr.write(`Invalid scope: ${scope}. Must be user, local, or project.\n`);
    process.exit(1);
  }

  if (removeHookOnly) {
    const result = await removeHook(scope);
    if (result === "removed") {
      process.stdout.write(`Removed Parecode SessionStart hook from ${resolveSettingsPath(scope)}.\n`);
    } else {
      process.stdout.write(`No Parecode SessionStart hook found in ${resolveSettingsPath(scope)}.\n`);
    }
    return;
  }

  const serveCommand = useLinked ? ["parecode", "serve"] : ["npx", "parecode", "serve"];
  const addCmdStr = `claude mcp add parecode -s ${scope} -- ${serveCommand.join(" ")}`;

  if (printOnly) {
    process.stdout.write(addCmdStr + "\n");
    if (withHook) {
      process.stdout.write(`# Would also install SessionStart hook in ${resolveSettingsPath(scope)} running: ${sessionStartCommandFor(useLinked)}\n`);
    }
    if (aggressiveHook) {
      process.stdout.write(`# Would also install PreToolUse hook (Grep|Glob) running: ${preToolUseCommandFor(useLinked)}\n`);
    }
    return;
  }

  const claudeCmdName = process.env.PARECODE_CLAUDE_CMD || "claude";
  const claudePath = await resolveCommand(claudeCmdName);
  if (!claudePath) {
    process.stderr.write(`Error: '${claudeCmdName}' CLI not found on PATH. Please install Claude Code first, or set PARECODE_CLAUDE_CMD to your wrapper binary (e.g. 'claude-personal').\n`);
    process.exit(1);
  }

  const getResult = await spawnCommand(claudePath, ["mcp", "get", "parecode"]);
  let alreadyRegistered = false;
  if (getResult.code === 0) {
    const out = getResult.stdout;
    const looksLikeParecode =
      out.includes("npx parecode serve") ||
      /Command:\s*(npx\s+)?parecode\b/i.test(out) ||
      out.includes("parecode serve");
    if (looksLikeParecode) {
      alreadyRegistered = true;
    } else {
      process.stderr.write("Error: A different MCP server named 'parecode' is already registered.\n");
      process.stderr.write(`Please run '${claudeCmdName} mcp remove parecode' first.\n`);
      process.exit(1);
    }
  }

  if (!alreadyRegistered) {
    const addResult = await spawnCommand(claudePath, ["mcp", "add", "parecode", "-s", scope, "--", ...serveCommand]);
    if (addResult.code !== 0) {
      process.stderr.write(`Failed to add Parecode to Claude:\n${addResult.stderr || addResult.stdout}\n`);
      process.exit(1);
    }
    process.stdout.write(`Successfully registered Parecode (scope: ${scope}).\n`);
  } else {
    process.stdout.write("Parecode is already registered with Claude.\n");
  }

  if (withHook) {
    const hookResult = await installHook(scope, useLinked);
    if (hookResult === "installed") {
      process.stdout.write(`Installed SessionStart hook at ${resolveSettingsPath(scope)}.\n`);
    } else {
      process.stdout.write(`SessionStart hook already present at ${resolveSettingsPath(scope)}.\n`);
    }
  }

  if (aggressiveHook) {
    const result = await installAggressiveHook(scope, useLinked);
    if (result === "installed") {
      process.stdout.write(`Installed PreToolUse hook (Grep|Glob → ParecodeSearch) at ${resolveSettingsPath(scope)}.\n`);
    } else {
      process.stdout.write(`PreToolUse hook already present at ${resolveSettingsPath(scope)}.\n`);
    }
  }
}
