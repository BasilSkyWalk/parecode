import { McpAdapter } from "../adapters/mcp.js";

async function main() {
  const adapter = new McpAdapter();
  
  adapter.registerTool(
    {
      name: "parecode_ping",
      description: "A minimal ping tool for testing.",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    async () => {
      return { status: "success", detail: "pong" };
    }
  );

  await adapter.start();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
