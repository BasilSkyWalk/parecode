import * as fs from "node:fs/promises";
import * as path from "node:path";
import envPaths from "env-paths";
import { ToolHost, ToolSpec, ToolHandler, SubagentResult } from "./base.js";
import { resolveCommand, spawnCommand } from "../infra/spawn.js";

const processStartupId = `${process.pid}-${process.hrtime.bigint().toString()}`;

export class CliAdapter implements ToolHost {
  private tools: Map<string, { spec: ToolSpec; handler: ToolHandler }> = new Map();
  private realpathCache = new Map<string, string>();

  public registerTool(spec: ToolSpec, handler: ToolHandler): void {
    this.tools.set(spec.name, { spec, handler });
  }

  public async readFile(filepath: string): Promise<string> {
    return await fs.readFile(filepath, "utf-8");
  }

  public async writeFile(filepath: string, content: string): Promise<void> {
    const crypto = await import("node:crypto");
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

  public log(level: "info" | "warn" | "error", msg: string, meta?: object): void {
    const logLine = JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      msg,
      meta,
    });
    process.stderr.write(logLine + "\n");
  }

  public recordStat(event: any): void {
    // In CLI mode, we might not have a tracker initialized, or we can just ignore.
    // Spec: "Tools without session-memory context (e.g. one-off CLI invocations) behave exactly as v0.2"
  }

  public async exec(cmd: string, args: string[], cwd?: string): Promise<{ stdout: string; stderr: string; code: number | null }> {
    return spawnCommand(cmd, args, cwd);
  }

  public async resolveCommand(cmd: string): Promise<string | null> {
    return resolveCommand(cmd);
  }

  public async realpath(p: string): Promise<string> {
    if (this.realpathCache.has(p)) {
      return this.realpathCache.get(p)!;
    }
    try {
      const rp = await fs.realpath(p);
      this.realpathCache.set(p, rp);
      return rp;
    } catch {
      this.realpathCache.set(p, p);
      return p;
    }
  }

  public async statFile(filepath: string): Promise<{ mtimeMs: number; size: number }> {
    const stats = await fs.stat(filepath);
    return {
      mtimeMs: stats.mtimeMs,
      size: stats.size,
    };
  }

  public async dispatchSubagent(_prompt: string, _model: string): Promise<SubagentResult> {
    return {
      status: "unavailable",
      detail: "subagent dispatch is not implemented in the CLI adapter",
    };
  }

  public sessionId(): string {
    return processStartupId;
  }

  public sessionDataPath(): string {
    return path.join(envPaths("parecode").data, "sessions");
  }
}
