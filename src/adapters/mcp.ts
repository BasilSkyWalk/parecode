import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as fs from "node:fs/promises";
import { ToolHost, ToolSpec, ToolHandler } from "./base.js";
import { z } from "zod";
import { resolveCommand, spawnCommand } from "../infra/spawn.js";

import { Tracker } from "../stats/tracker.js";

export class McpAdapter implements ToolHost {
  private server: McpServer;
  private tracker: Tracker;

  constructor() {
    this.tracker = new Tracker();
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

  public async writeFile(path: string, content: string): Promise<void> {
    await fs.writeFile(path, content, "utf-8");
  }

  public async statFile(path: string): Promise<{ mtimeMs: number; size: number }> {
    const stats = await fs.stat(path);
    return {
      mtimeMs: stats.mtimeMs,
      size: stats.size,
    };
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

  public recordStat(event: any): void {
    this.tracker.record(event).catch(() => {});
  }

  public async exec(cmd: string, args: string[], cwd?: string): Promise<{ stdout: string; stderr: string; code: number | null }> {
    return spawnCommand(cmd, args, cwd);
  }

  public async resolveCommand(cmd: string): Promise<string | null> {
    return resolveCommand(cmd);
  }

  public async start(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    this.log("info", "Parecode MCP server started");
  }
}
