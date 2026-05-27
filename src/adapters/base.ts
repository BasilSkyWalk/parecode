export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export type ToolHandler = (args: any) => Promise<unknown>;

export interface ToolHost {
  registerTool(spec: ToolSpec, handler: ToolHandler): void;
  readFile(path: string): Promise<string>;
  log(level: "info" | "warn" | "error", msg: string, meta?: object): void;
  recordStat(event: any): void;
  exec(cmd: string, args: string[], cwd?: string): Promise<{ stdout: string; stderr: string; code: number | null }>;
  resolveCommand(cmd: string): Promise<string | null>;
  statFile(path: string): Promise<{ mtimeMs: number; size: number }>;
}
