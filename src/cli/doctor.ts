import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { fileURLToPath } from "node:url";
import * as readline from "node:readline";
import { createReadStream } from "node:fs";
import envPaths from "env-paths";
import { resolveCommand, spawnCommand } from "../infra/spawn.js";
import { transcriptDirExists, resolveTranscriptDir, listProjectDirs, listSessionFiles } from "../infra/claudeCodeTranscripts.js";
import { parseTranscriptLine } from "../stats/transcriptParser.js";
import { parsePluginListing } from "../infra/plugin.js";

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

async function findCodeGraphDir(): Promise<string | null> {
  const cwdCandidate = path.join(process.cwd(), ".codegraph");
  try {
    const st = await fs.stat(cwdCandidate);
    if (st.isDirectory()) return cwdCandidate;
  } catch {}
  const gitTopResult = await spawnCommand("git", ["rev-parse", "--show-toplevel"], process.cwd());
  if (gitTopResult.code === 0) {
    const top = gitTopResult.stdout.trim();
    if (top) {
      const repoCandidate = path.join(top, ".codegraph");
      try {
        const st = await fs.stat(repoCandidate);
        if (st.isDirectory()) return repoCandidate;
      } catch {}
    }
  }
  return null;
}

async function isInsideGitRepo(): Promise<boolean> {
  const r = await spawnCommand("git", ["rev-parse", "--is-inside-work-tree"], process.cwd());
  return r.code === 0 && r.stdout.trim() === "true";
}

async function reportCodeGraph(): Promise<void> {
  const cgDir = await findCodeGraphDir();
  if (cgDir) {
    process.stdout.write(`CodeGraph:     Detected at ${cgDir}\n`);
    process.stdout.write(
      `               Prefer codegraph_explore for broad flow questions; use ParecodeSearch for targeted multi-pattern lookups and ParecodeExpand for widening matches.\n`,
    );
    return;
  }
  if (await isInsideGitRepo()) {
    process.stdout.write(`CodeGraph:     Not initialised in this repo\n`);
    process.stdout.write(
      `               Run 'codegraph init -i' to enable broader code-graph queries alongside parecode.\n`,
    );
  }
}

async function isTranscriptSchemaOk(filePath: string): Promise<boolean> {
  try {
    const fileStream = createReadStream(filePath);
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.trim()) {
        continue;
      }
      const records = parseTranscriptLine(line);
      if (records.some((r) => r.type !== undefined || r.toolName !== undefined)) {
        rl.close();
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

async function reportTranscripts(): Promise<void> {
  const exists = await transcriptDirExists();
  const dirPath = resolveTranscriptDir();
  if (!exists) {
    process.stdout.write(`Transcripts:   Not found at ${dirPath}\n`);
    return;
  }

  const projects = await listProjectDirs();
  let totalFiles = 0;
  let firstFile: string | undefined;

  for (const proj of projects) {
    const files = await listSessionFiles(proj);
    totalFiles += files.length;
    if (firstFile === undefined && files.length > 0) {
      firstFile = files[0];
    }
  }

  process.stdout.write(`Transcripts:   Found at ${dirPath}\n`);
  if (totalFiles === 0) {
    process.stdout.write(`               (Directory exists, but no .jsonl session files found)\n`);
    return;
  }

  if (firstFile === undefined) {
    return;
  }

  const schemaOk = await isTranscriptSchemaOk(firstFile);
  if (schemaOk) {
    process.stdout.write(`               Schema OK (${totalFiles} files available for retroactive scan)\n`);
  } else {
    process.stdout.write(`               Schema UNKNOWN (JSONL format may have drifted)\n`);
  }
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

    const listResult = await spawnCommand(claudePath, ["plugin", "list"]);
    let pluginStatus = "Not registered";
    if (listResult.code === 0) {
      const details = parsePluginListing(listResult.stdout);
      if (details) {
        pluginStatus = `Installed (scope: ${details.scope}, version: ${details.version})`;
      }
    }
    process.stdout.write(`Plugin Status: ${pluginStatus}\n`);
  } else {
    process.stdout.write(`MCP Status:    Claude CLI not found on PATH\n`);
    process.stdout.write(`Plugin Status: Claude CLI not found on PATH\n`);
  }

  const userConfigDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
  const userSettingsPath = path.join(userConfigDir, "settings.json");
  let sessionStartStatus = "Not installed";
  let preToolUseStatus = "Not installed";
  try {
    const raw = await fs.readFile(userSettingsPath, "utf-8");
    const settings = JSON.parse(raw);
    for (const entry of settings?.hooks?.SessionStart ?? []) {
      for (const h of entry?.hooks ?? []) {
        if (h?.type === "command" && typeof h.command === "string" && h.command.includes("parecode hook session-start")) {
          sessionStartStatus = "Installed (user scope)";
        }
      }
    }
    for (const entry of settings?.hooks?.PreToolUse ?? []) {
      for (const h of entry?.hooks ?? []) {
        if (h?.type === "command" && typeof h.command === "string" && h.command.includes("parecode hook pre-tool-use")) {
          preToolUseStatus = "Installed (user scope)";
        }
      }
    }
  } catch {}
  process.stdout.write(`SessionStart:  ${sessionStartStatus}\n`);
  process.stdout.write(`PreToolUse:    ${preToolUseStatus}\n`);

  await reportTranscripts();
  await reportCodeGraph();

  const rgCmd = os.platform() === "win32" ? "rg.exe" : "rg";
  const rgPath = await resolveCommand(rgCmd);
  if (rgPath) {
    const rgVersionResult = await spawnCommand(rgPath, ["--version"]);
    const firstLine = rgVersionResult.stdout.trim().split(/\r?\n/)[0];
    process.stdout.write(`Ripgrep:       ${firstLine}\n`);
  } else {
    process.stdout.write(`Ripgrep:       Not found on PATH (ERROR: ripgrep is required)\n`);
    process.exit(1);
  }
}
