import { McpAdapter } from "../adapters/mcp.js";
import { SearchEngine, SearchArgs } from "../engine/search.js";

async function main() {
  const adapter = new McpAdapter();
  const searchEngine = new SearchEngine(adapter);
  
  adapter.registerTool(
    {
      name: "ParecodeSearch",
      description: "Search across the codebase with optional AST-aware truncation to reduce tokens.",
      inputSchema: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Ripgrep search pattern" },
          paths: { type: "array", items: { type: "string" }, description: "Paths to search" },
          contextLines: { type: "number", description: "Lines of context (unused in M0)" },
          truncate: { type: "string", enum: ["none", "signatures", "full"], description: "Truncation mode" }
        },
        required: ["pattern"]
      },
    },
    async (args: unknown) => {
      const searchArgs = args as SearchArgs;
      return await searchEngine.search(searchArgs);
    }
  );

  await adapter.start();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
