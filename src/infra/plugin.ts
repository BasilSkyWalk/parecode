import * as path from "node:path";
import { fileURLToPath } from "node:url";

export const PARECODE_PLUGIN_ID = "parecode-explore";

export function getBundledPluginDir(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../plugins/claude-code");
}

const idBoundary = new RegExp(`(^|[^A-Za-z0-9_-])${PARECODE_PLUGIN_ID}([^A-Za-z0-9_-]|$)`, "m");

export function isPluginInstalled(listStdout: string): boolean {
  return idBoundary.test(listStdout);
}

export interface PluginListingDetails {
  version: string;
  scope: string;
}

export function parsePluginListing(listStdout: string): PluginListingDetails | null {
  const lines = listStdout.split(/\r?\n/);
  const lineMatch = new RegExp(`(^|[^A-Za-z0-9_-])${PARECODE_PLUGIN_ID}([^A-Za-z0-9_-]|$)`);
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
