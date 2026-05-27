import { spawn } from "node:child_process";

/**
 * Resolves the path to the ripgrep binary using `which`.
 * Returns the absolute path, or null if not found.
 */
export async function resolveRipgrep(): Promise<string | null> {
  return new Promise((resolve) => {
    const whichProc = spawn("which", ["rg"]);
    let out = "";
    
    whichProc.stdout.on("data", (data) => {
      out += data.toString();
    });

    whichProc.on("close", (code) => {
      if (code === 0 && out.trim().length > 0) {
        resolve(out.trim());
      } else {
        resolve(null);
      }
    });

    whichProc.on("error", () => {
      resolve(null);
    });
  });
}

/**
 * Result from running a command.
 */
export interface SpawnResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

/**
 * Runs a command with the given arguments, avoiding the shell.
 */
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
