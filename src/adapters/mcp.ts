import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as fs from "node:fs/promises";
import { ToolHost, ToolSpec, ToolHandler, SubagentResult } from "./base.js";
import { resolveCommand, spawnCommand } from "../infra/spawn.js";

import { Tracker } from "../stats/tracker.js";
import { EnvelopeLogger } from "../stats/envelope.js";

export class McpAdapter implements ToolHost {
  private server: Server;
  private tracker: Tracker;
  private envelope: EnvelopeLogger;
  private tools: Map<string, { spec: ToolSpec; handler: ToolHandler }> = new Map();

  constructor() {
    this.tracker = new Tracker();
    this.envelope = new EnvelopeLogger(this.tracker.getSessionId());
    this.server = new Server(
      { name: "parecode", version: "0.0.0" },
      { capabilities: { tools: {} } }
    );

    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: Array.from(this.tools.values()).map(t => ({
          name: t.spec.name,
          description: t.spec.description,
          inputSchema: t.spec.inputSchema as any
        }))
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const tool = this.tools.get(request.params.name);
      if (!tool) {
        throw new Error(`Tool not found: ${request.params.name}`);
      }
      const startedAt = Date.now();
      try {
        const result = await tool.handler(request.params.arguments);
        const text = JSON.stringify(result, null, 2);
        this.envelope.record({
          toolCall: tool.spec.name,
          bytesReturned: Buffer.byteLength(text, "utf-8"),
          durationMs: Date.now() - startedAt,
          isError: false,
        }).catch(() => {});
        return {
          content: [{ type: "text", text }]
        };
      } catch (error) {
        const err = error as Error;
        const errorText = `Error: ${err.message}`;
        this.recordStat({
          toolCall: tool.spec.name,
          estimatedNativeTokens: 0,
          actualTokens: 0,
          callsBatched: 0,
          error: err.message,
        });
        this.envelope.record({
          toolCall: tool.spec.name,
          bytesReturned: Buffer.byteLength(errorText, "utf-8"),
          durationMs: Date.now() - startedAt,
          isError: true,
        }).catch(() => {});
        return {
          content: [{ type: "text", text: errorText }],
          isError: true,
        };
      }
    });
  }

  public async initTracker(): Promise<void> {
    await this.tracker.init();
    await this.envelope.init();
  }

  public async finalizeTracker(): Promise<void> {
    await this.tracker.finalize();
    await this.envelope.flush();
  }

  public registerTool(spec: ToolSpec, handler: ToolHandler): void {
    this.tools.set(spec.name, { spec, handler });
  }

  public async readFile(path: string): Promise<string> {
    return await fs.readFile(path, "utf-8");
  }

  public async writeFile(filepath: string, content: string): Promise<void> {
    const crypto = await import("node:crypto");
    const path = await import("node:path");
    const tmpPath = `${filepath}.${process.pid}-${crypto.randomUUID()}.parecodetmp`;
    let fh;
    try {
      fh = await fs.open(tmpPath, "w");
      await fh.writeFile(content, "utf-8");
      await fh.sync();
    } finally {
      if (fh) {
        await fh.close();
      }
    }
    await fs.rename(tmpPath, filepath);

    const dir = path.dirname(filepath);
    fs.readdir(dir).then((files) => {
      for (const f of files) {
        if (f.endsWith(".parecodetmp") && !f.includes(`.${process.pid}-`)) {
          fs.unlink(path.join(dir, f)).catch(() => {});
        }
      }
    }).catch(() => {});
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

  public async dispatchSubagent(_prompt: string, _model: string): Promise<SubagentResult> {
    return {
      status: "unavailable",
      detail: "subagent dispatch is not implemented in the MCP adapter (v1); the host model should invoke its own Task tool",
    };
  }

  public async start(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    this.log("info", "Parecode MCP server started");
  }
}
