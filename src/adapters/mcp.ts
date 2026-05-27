import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as fs from "node:fs/promises";
import { ToolHost, ToolSpec, ToolHandler } from "./base.js";
import { z } from "zod";

export class McpAdapter implements ToolHost {
  private server: McpServer;

  constructor() {
    this.server = new McpServer(
      {
        name: "parecode",
        version: "0.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );
  }

  public registerTool(spec: ToolSpec, handler: ToolHandler): void {
    this.server.tool(
      spec.name,
      spec.description,
      {
        args: z.any(),
      },
      async (args) => {
        try {
          const result = await handler(args.args);
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        } catch (error) {
          const err = error as Error;
          return {
            content: [{ type: "text", text: `Error: ${err.message}` }],
            isError: true,
          };
        }
      }
    );
  }

  public async readFile(path: string): Promise<string> {
    return await fs.readFile(path, "utf-8");
  }

  public log(
    level: "info" | "warn" | "error",
    msg: string,
    meta?: object
  ): void {
    const logLine = JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      msg,
      meta,
    });
    process.stderr.write(logLine + "\n");
  }

  public async start(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    this.log("info", "Parecode MCP server started");
  }
}
