import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { SearchEngine } from "../src/engine/search.js";
import { ToolHost, ToolSpec, ToolHandler } from "../src/adapters/base.js";
import { Tracker } from "../src/stats/tracker.js";

class HarnessHost implements ToolHost {
  private tracker = new Tracker();

  registerTool(spec: ToolSpec, handler: ToolHandler): void {}

  async readFile(filePath: string): Promise<string> {
    return fs.readFile(filePath, "utf-8");
  }

  log(level: "info" | "warn" | "error", msg: string, meta?: object): void {}

  recordStat(event: any): void {
    this.tracker.record(event).catch(console.error);
  }
}

const REPOS_DIR = path.resolve(process.cwd(), "harness", "repos");
const SESSION_LOG = path.resolve(process.cwd(), "harness", "session.jsonl");

async function main() {
  await fs.mkdir(REPOS_DIR, { recursive: true });
  await fs.rm(SESSION_LOG, { force: true });

  const reposData = JSON.parse(await fs.readFile(path.resolve(process.cwd(), "harness", "repos.json"), "utf-8"));
  
  const host = new HarnessHost();
  const searchEngine = new SearchEngine(host);

  for (const repo of reposData) {
    const repoPath = path.join(REPOS_DIR, repo.name);
    
    try {
      await fs.access(repoPath);
      console.log("Repo " + repo.name + " already cloned.");
    } catch {
      console.log("Cloning " + repo.name + "...");
      execSync("git clone --depth 1 " + repo.url + " " + repoPath, { stdio: "inherit" });
    }

    process.chdir(repoPath);

    console.log("Running simulated session for " + repo.name + "...");

    const queries = [
      { pattern: "class ", truncate: "signatures" as const },
      { pattern: "class ", truncate: "none" as const },
      { pattern: "interface ", truncate: "signatures" as const },
      { pattern: "throw new Error", truncate: "signatures" as const }
    ];

    for (const q of queries) {
      console.log('  -> Search: "' + q.pattern + '", truncate: ' + q.truncate);
      const res = await searchEngine.search({
        pattern: q.pattern,
        truncate: q.truncate,
        paths: ["."]
      });
      console.log("     Matches: " + (res.matches?.length || 0));
    }
  }

  console.log("Sessions completed! Results written to harness/session.jsonl");
}

main().catch(console.error);
