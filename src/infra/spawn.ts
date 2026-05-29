import { spawn } from "node:child_process";
import * as os from "node:os";

export async function resolveCommand(cmd: string): Promise<string | null> {
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

export async function spawnCommand(
  cmd: string,
  args: string[],
  cwd?: string
): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { cwd, shell: false });
    
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
