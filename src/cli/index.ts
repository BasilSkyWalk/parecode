#!/usr/bin/env node
import { McpAdapter } from "../adapters/mcp.js";
import { SearchEngine, SearchArgs } from "../engine/search.js";
import { ParecodeSearchToolSpec } from "../tools/search.js";
import { EditEngine, EditRequest } from "../engine/edit.js";
import { ParecodeEditToolSpec } from "../tools/edit.js";
import { ExpandEngine, ExpandArgs } from "../engine/expand.js";
import { ParecodeExpandToolSpec } from "../tools/expand.js";
import { initCommand } from "./init.js";
import { statsCommand } from "./stats.js";
import { pruneCommand } from "./prune.js";
import { doctorCommand } from "./doctor.js";
import { flushCommand } from "./flush.js";
import { hookCommand } from "./hook.js";
import { tokensCommand } from "./tokens.js";
import { envelopeCommand } from "./envelope.js";

async function serve() {
  const adapter = new McpAdapter();
  await adapter.initTracker();

  const searchEngine = new SearchEngine(adapter);
  adapter.registerTool(
    ParecodeSearchToolSpec,
    async (args: unknown) => {
      const searchArgs = args as SearchArgs;
      return await searchEngine.search(searchArgs);
    }
  );

  const editEngine = new EditEngine(adapter);
  adapter.registerTool(
    ParecodeEditToolSpec,
    async (args: unknown) => {
      const editArgs = args as EditRequest;
      return await editEngine.edit(editArgs);
    }
  );

  const expandEngine = new ExpandEngine(adapter);
  adapter.registerTool(
    ParecodeExpandToolSpec,
    async (args: unknown) => {
      const expandArgs = args as ExpandArgs;
      return await expandEngine.expand(expandArgs);
    }
  );

  await adapter.start();

  const shutdown = async () => {
    await adapter.finalizeTracker();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0] || "serve";

  switch (cmd) {
    case "serve":
      await serve();
      break;
    case "init":
      await initCommand(args.slice(1));
      break;
    case "stats":
      await statsCommand(args.slice(1));
      break;
    case "prune":
      await pruneCommand(args.slice(1));
      break;
    case "doctor":
      await doctorCommand();
      break;
    case "flush":
      await flushCommand();
      break;
    case "hook":
      await hookCommand(args.slice(1));
      break;
    case "tokens":
      await tokensCommand(args.slice(1));
      break;
    case "envelope":
      await envelopeCommand(args.slice(1));
      break;
    default:
      process.stderr.write(`Unknown command: ${cmd}\n`);
      process.exit(1);
  }
}

main().catch((err) => {
  process.stderr.write(`Fatal error: ${err}\n`);
  process.exit(1);
});
