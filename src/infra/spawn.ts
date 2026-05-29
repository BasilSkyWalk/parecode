import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";

async function resolveBundledRipgrep(): Promise<string | null> {
  try {
    const mod = await import("@vscode/ripgrep");
    const candidate = mod.rgPath;
    if (typeof candidate !== "string" || candidate.length === 0) return null;
    await fs.access(candidate);
    return candidate;
  } catch {
    return null;
  }
}

export async function resolveCommand(cmd: string): Promise<string | null> {
  if (cmd === "rg" || cmd === "rg.exe") {
    const bundled = await resolveBundledRipgrep();
    if (bundled) return bundled;
  }
  return new Promise((resolve) => {
    const isWin = os.platform() === "win32";
    const resolverCmd = isWin ? "where" : "which";
    const whichProc = spawn(resolverCmd, [cmd]);
    let out = "";
    
    whichProc.stdout.on("data", (data) => {
      out += data.toString();
    });

    whichProc.on("close", (code) => {
      if (code === 0 && out.trim().length > 0) {
        const lines = out.trim().split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        if (isWin) {
          const pathext = (process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD")
            .split(";")
            .map((e) => e.trim().toLowerCase())
            .filter(Boolean);
          for (const ext of pathext) {
            const hit = lines.find((l) => l.toLowerCase().endsWith(ext));
            if (hit) {
              resolve(hit);
              return;
            }
          }
        }
        resolve(lines[0]);
      } else {
        resolve(null);
      }
    });

    whichProc.on("error", () => {
      resolve(null);
    });
  });
}

export interface SpawnResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

function quoteWindowsArg(arg: string): string {
  if (arg.length === 0) return '""';
  if (!/[\s"&|<>^()%!]/.test(arg)) return arg;
  return `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')}"`;
}

export async function spawnCommand(
  cmd: string,
  args: string[],
  cwd?: string
): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const isWin = os.platform() === "win32";
    const needsShell = isWin && /\.(cmd|bat)$/i.test(cmd);
    const finalCmd = needsShell ? `"${cmd}" ${args.map(quoteWindowsArg).join(" ")}` : cmd;
    const finalArgs = needsShell ? [] : args;
    const proc = spawn(finalCmd, finalArgs, { cwd, shell: needsShell });
    
    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("error", (err) => {
      reject(err);
    });

    proc.on("close", (code) => {
      resolve({ stdout, stderr, code });
    });
  });
}
