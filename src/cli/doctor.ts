import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { fileURLToPath } from "node:url";
import envPaths from "env-paths";
import { resolveCommand, spawnCommand } from "../infra/spawn.js";

async function getDirSize(dirPath: string): Promise<number> {
  let size = 0;
  try {
    const files = await fs.readdir(dirPath, { withFileTypes: true });
    for (const file of files) {
      if (file.isFile()) {
        const stats = await fs.stat(path.join(dirPath, file.name));
        size += stats.size;
      }
    }
  } catch {}
  return size;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

export async function doctorCommand() {
  process.stdout.write("Parecode Doctor\n");
  process.stdout.write("───────────────\n\n");

  let version = "unknown";
  try {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const pkgPath = path.join(__dirname, "../../package.json");
    const pkgData = await fs.readFile(pkgPath, "utf-8");
    version = JSON.parse(pkgData).version;
  } catch {}
  process.stdout.write(`Version:       ${version}\n`);

  const dataDir = envPaths("parecode").data;
  const sessionDir = path.join(dataDir, "sessions");
  const size = await getDirSize(sessionDir);
  process.stdout.write(`Data Dir:      ${dataDir}\n`);
  process.stdout.write(`Log Size:      ${formatBytes(size)}\n`);

  const claudePath = await resolveCommand("claude");
  if (claudePath) {
    const getResult = await spawnCommand(claudePath, ["mcp", "get", "parecode"]);
    if (getResult.code === 0) {
      process.stdout.write(`MCP Status:    Registered with Claude\n`);
    } else {
      process.stdout.write(`MCP Status:    Not registered\n`);
    }
  } else {
    process.stdout.write(`MCP Status:    Claude CLI not found on PATH\n`);
  }

  const rgCmd = os.platform() === "win32" ? "rg.exe" : "rg";
  const rgPath = await resolveCommand(rgCmd);
  if (rgPath) {
    const rgVersionResult = await spawnCommand(rgPath, ["--version"]);
    const firstLine = rgVersionResult.stdout.trim().split(/\r?\n/)[0];
    process.stdout.write(`Ripgrep:       ${firstLine}\n`);
  } else {
    process.stdout.write(`Ripgrep:       Not found on PATH\n`);
  }
}
