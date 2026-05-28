import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { spawnCommand, resolveCommand } from "../infra/spawn.js";

interface ClaudeSettings {
  hooks?: {
    SessionStart?: Array<{
      hooks?: Array<{ type: string; command: string }>;
    }>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

function resolveSettingsPath(scope: string): string {
  if (scope === "user") {
    return path.join(os.homedir(), ".claude", "settings.json");
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

function hookCommandFor(useLinked: boolean): string {
  return useLinked ? "parecode hook session-start" : "npx parecode hook session-start";
}

function matchesParecodeHook(command: string): boolean {
  return command === "parecode hook session-start" || command === "npx parecode hook session-start";
}

async function installHook(scope: string, useLinked: boolean): Promise<"installed" | "already-present"> {
  const filepath = resolveSettingsPath(scope);
  const settings = await readSettings(filepath);
  if (!settings.hooks) settings.hooks = {};
  if (!settings.hooks.SessionStart) settings.hooks.SessionStart = [];

  const desiredCommand = hookCommandFor(useLinked);
  for (const entry of settings.hooks.SessionStart) {
    for (const h of entry.hooks ?? []) {
      if (h.type === "command" && matchesParecodeHook(h.command)) {
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

async function removeHook(scope: string): Promise<"removed" | "not-present"> {
  const filepath = resolveSettingsPath(scope);
  const settings = await readSettings(filepath);
  if (!settings.hooks?.SessionStart) return "not-present";

  let changed = false;
  const filtered: Array<{ hooks?: Array<{ type: string; command: string }> }> = [];
  for (const entry of settings.hooks.SessionStart) {
    const remaining = (entry.hooks ?? []).filter(
      (h) => !(h.type === "command" && matchesParecodeHook(h.command)),
    );
    if (remaining.length !== (entry.hooks ?? []).length) changed = true;
    if (remaining.length > 0) filtered.push({ hooks: remaining });
  }

  if (!changed) return "not-present";

  if (filtered.length > 0) {
    settings.hooks.SessionStart = filtered;
  } else {
    delete settings.hooks.SessionStart;
    if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
  }
  await writeSettings(filepath, settings);
  return "removed";
}

export async function initCommand(args: string[]) {
  let scope = "user";
  let printOnly = false;
  let useLinked = false;
  let withHook = false;
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
      process.stdout.write(`# Would also install SessionStart hook in ${resolveSettingsPath(scope)} running: ${hookCommandFor(useLinked)}\n`);
    }
    return;
  }

  const claudePath = await resolveCommand("claude");
  if (!claudePath) {
    process.stderr.write("Error: 'claude' CLI not found on PATH. Please install Claude Code first.\n");
    process.exit(1);
  }

  const getResult = await spawnCommand(claudePath, ["mcp", "get", "parecode"]);
  let alreadyRegistered = false;
  if (getResult.code === 0) {
    if (getResult.stdout.includes("npx parecode serve") || getResult.stdout.includes("parecode serve")) {
      alreadyRegistered = true;
    } else {
      process.stderr.write("Error: A different MCP server named 'parecode' is already registered.\n");
      process.stderr.write("Please run 'claude mcp remove parecode' first.\n");
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
}
