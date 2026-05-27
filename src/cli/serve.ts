import { McpAdapter } from "../adapters/mcp.js";
import { SearchEngine, SearchArgs } from "../engine/search.js";
import { ParecodeSearchToolSpec } from "../tools/search.js";
import { EditEngine, EditRequest } from "../engine/edit.js";
import { ParecodeEditToolSpec } from "../tools/edit.js";

async function main() {
  const adapter = new McpAdapter();
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

  await adapter.start();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
