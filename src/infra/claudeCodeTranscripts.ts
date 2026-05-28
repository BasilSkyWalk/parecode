import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

function userConfigDir(): string {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
}

export function resolveTranscriptDir(): string {
  return path.join(userConfigDir(), "projects");
}

export async function transcriptDirExists(): Promise<boolean> {
  try {
    const stat = await fs.stat(resolveTranscriptDir());
    return stat.isDirectory();
  } catch {
    return false;
  }
}

export async function listProjectDirs(): Promise<string[]> {
  const root = resolveTranscriptDir();
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => path.join(root, e.name))
      .sort();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

export async function listSessionFiles(projectDir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(projectDir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && e.name.endsWith(".jsonl"))
      .map((e) => path.join(projectDir, e.name))
      .sort();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

export function decodeProjectName(encoded: string): string {
  const name = path.basename(encoded);
  const sep = path.sep;
  if (name.startsWith("-")) {
    return sep + name.slice(1).replace(/-/g, sep);
  }
  return name.replace(/-/g, sep);
}
