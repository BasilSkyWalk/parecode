import { spawnCommand, resolveCommand } from "../infra/spawn.js";

export async function initCommand(args: string[]) {
  let scope = "user";
  let printOnly = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--scope" && i + 1 < args.length) {
      scope = args[i + 1];
      i++;
    } else if (args[i] === "--print") {
      printOnly = true;
    }
  }

  if (!["user", "local", "project"].includes(scope)) {
    process.stderr.write(`Invalid scope: ${scope}. Must be user, local, or project.\n`);
    process.exit(1);
  }

  const addCmdStr = `claude mcp add parecode -s ${scope} -- npx parecode serve`;

  if (printOnly) {
    process.stdout.write(addCmdStr + "\n");
    return;
  }

  const claudePath = await resolveCommand("claude");
  if (!claudePath) {
    process.stderr.write("Error: 'claude' CLI not found on PATH. Please install Claude Code first.\n");
    process.exit(1);
  }

  const getResult = await spawnCommand(claudePath, ["mcp", "get", "parecode"]);
  if (getResult.code === 0) {
    if (getResult.stdout.includes("npx parecode serve") || getResult.stdout.includes("parecode serve")) {
      process.stdout.write("Parecode is already registered with Claude.\n");
      return;
    } else {
      process.stderr.write("Error: A different MCP server named 'parecode' is already registered.\n");
      process.stderr.write("Please run 'claude mcp remove parecode' first.\n");
      process.exit(1);
    }
  }

  const addResult = await spawnCommand(claudePath, ["mcp", "add", "parecode", "-s", scope, "--", "npx", "parecode", "serve"]);
  if (addResult.code !== 0) {
    process.stderr.write(`Failed to add Parecode to Claude:\n${addResult.stderr || addResult.stdout}\n`);
    process.exit(1);
  }

  process.stdout.write(`Successfully registered Parecode (scope: ${scope}).\n`);
}
