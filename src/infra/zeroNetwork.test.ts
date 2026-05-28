import { describe, expect, it } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(here, "..");
const installEscapeHatch = path.join(srcRoot, "infra", "install");

const forbiddenPatterns: Array<{ name: string; re: RegExp }> = [
  { name: "node:http import", re: /from\s+['"]node:https?['"]/ },
  { name: "bare http import", re: /from\s+['"]https?['"]/ },
  { name: "http require", re: /require\(\s*['"](node:)?https?['"]\s*\)/ },
  { name: "undici import", re: /from\s+['"]undici['"]/ },
  { name: "fetch call", re: /(^|[^.\w])fetch\s*\(/m },
];

async function collectSourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const results: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (full === installEscapeHatch) continue;
      results.push(...(await collectSourceFiles(full)));
    } else if (entry.isFile() && full.endsWith(".ts") && !full.endsWith(".test.ts")) {
      results.push(full);
    }
  }
  return results;
}

describe("zero-network runtime guarantee", () => {
  it("contains no http/https/fetch usage outside src/infra/install/", async () => {
    const files = await collectSourceFiles(srcRoot);
    const offenders: string[] = [];
    for (const file of files) {
      const body = await readFile(file, "utf8");
      for (const pattern of forbiddenPatterns) {
        if (pattern.re.test(body)) {
          offenders.push(`${path.relative(srcRoot, file)} — ${pattern.name}`);
        }
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});
