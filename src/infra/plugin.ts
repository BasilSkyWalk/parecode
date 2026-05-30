import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export const PARECODE_PLUGIN_ID = "parecode-explore";
export const PARECODE_MARKETPLACE_NAME = "parecode";
export const PARECODE_MARKETPLACE_GIT_URL = "https://github.com/BasilSkyWalk/parecode.git";

export function getLocalMarketplaceDir(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
}

export function getMarketplaceSource(useLinked: boolean): string {
  return useLinked ? getLocalMarketplaceDir() : PARECODE_MARKETPLACE_GIT_URL;
}

function tokenBoundary(token: string): RegExp {
  return new RegExp(`(^|[^A-Za-z0-9_-])${token}([^A-Za-z0-9_-]|$)`);
}

export function isPluginInstalled(listStdout: string): boolean {
  return tokenBoundary(PARECODE_PLUGIN_ID).test(listStdout);
}

export function isMarketplaceAdded(marketplaceListStdout: string): boolean {
  return tokenBoundary(PARECODE_MARKETPLACE_NAME).test(marketplaceListStdout);
}

export interface PluginListingDetails {
  version: string;
  scope: string;
}

export function parsePluginListing(listStdout: string): PluginListingDetails | null {
  const lines = listStdout.split(/\r?\n/);
  const lineMatch = tokenBoundary(PARECODE_PLUGIN_ID);
  for (let i = 0; i < lines.length; i++) {
    if (lineMatch.test(lines[i])) {
      const windowText = lines.slice(i, i + 10).join("\n");
      const versionMatch = windowText.match(/Version:\s+(\S+)/);
      const scopeMatch = windowText.match(/Scope:\s+(\S+)/);
      return {
        version: versionMatch ? versionMatch[1] : "unknown",
        scope: scopeMatch ? scopeMatch[1] : "unknown",
      };
    }
  }
  return null;
}

export async function readBundledPluginVersion(): Promise<string | null> {
  const dir = getLocalMarketplaceDir();
  const pluginJsonPath = path.join(dir, "plugins", "claude-code", ".claude-plugin", "plugin.json");
  try {
    const raw = await fs.readFile(pluginJsonPath, "utf-8");
    const parsed = JSON.parse(raw) as { version?: unknown };
    return typeof parsed.version === "string" ? parsed.version : null;
  } catch {
    return null;
  }
}

function parseSemverParts(value: string): number[] | null {
  const match = value.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [parseInt(match[1], 10), parseInt(match[2], 10), parseInt(match[3], 10)];
}

export function shouldUpgradePlugin(installed: string, bundled: string): boolean {
  if (!installed || installed === "unknown") return false;
  if (!bundled) return false;
  if (installed === bundled) return false;
  const a = parseSemverParts(installed);
  const b = parseSemverParts(bundled);
  if (!a || !b) return installed !== bundled;
  for (let i = 0; i < 3; i++) {
    if (a[i] < b[i]) return true;
    if (a[i] > b[i]) return false;
  }
  return false;
}
