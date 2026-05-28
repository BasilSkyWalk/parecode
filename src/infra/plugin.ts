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
