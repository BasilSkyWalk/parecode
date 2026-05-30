import { describe, it, expect } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  isPluginInstalled,
  isMarketplaceAdded,
  parsePluginListing,
  readBundledPluginVersion,
  shouldUpgradePlugin,
} from "./plugin.js";

describe("isPluginInstalled", () => {
  it("matches the plugin id as a token", () => {
    expect(isPluginInstalled("parecode-explore something")).toBe(true);
    expect(isPluginInstalled("name: parecode-explore\n")).toBe(true);
  });
  it("rejects substring-only matches", () => {
    expect(isPluginInstalled("parecode-explorer")).toBe(false);
    expect(isPluginInstalled("xparecode-explorex")).toBe(false);
  });
  it("rejects empty/unrelated output", () => {
    expect(isPluginInstalled("")).toBe(false);
    expect(isPluginInstalled("some other plugin")).toBe(false);
  });
});

describe("isMarketplaceAdded", () => {
  it("matches marketplace name as token", () => {
    expect(isMarketplaceAdded("parecode (https://...)")).toBe(true);
    expect(isMarketplaceAdded("nothing here")).toBe(false);
  });
});

describe("parsePluginListing", () => {
  it("extracts version and scope from a multi-line listing", () => {
    const out = [
      "Some other plugin",
      "  Version: 9.9.9",
      "  Scope: user",
      "",
      "parecode-explore",
      "  Version: 0.4.0",
      "  Scope: user",
    ].join("\n");
    expect(parsePluginListing(out)).toEqual({ version: "0.4.0", scope: "user" });
  });
  it("returns null when not found", () => {
    expect(parsePluginListing("nothing")).toBeNull();
  });
  it("returns unknown for missing fields", () => {
    expect(parsePluginListing("parecode-explore\n")).toEqual({
      version: "unknown",
      scope: "unknown",
    });
  });
});

describe("shouldUpgradePlugin", () => {
  it("upgrades when installed is older than bundled", () => {
    expect(shouldUpgradePlugin("0.4.0", "0.4.11")).toBe(true);
    expect(shouldUpgradePlugin("0.4.10", "0.4.11")).toBe(true);
    expect(shouldUpgradePlugin("0.3.9", "0.4.0")).toBe(true);
    expect(shouldUpgradePlugin("0.4.0", "1.0.0")).toBe(true);
  });
  it("does not upgrade when equal or newer", () => {
    expect(shouldUpgradePlugin("0.4.11", "0.4.11")).toBe(false);
    expect(shouldUpgradePlugin("0.5.0", "0.4.11")).toBe(false);
    expect(shouldUpgradePlugin("1.0.0", "0.4.0")).toBe(false);
  });
  it("does not upgrade unknown installed versions", () => {
    expect(shouldUpgradePlugin("unknown", "0.4.11")).toBe(false);
    expect(shouldUpgradePlugin("", "0.4.11")).toBe(false);
  });
  it("does not upgrade when bundled is missing", () => {
    expect(shouldUpgradePlugin("0.4.0", "")).toBe(false);
  });
  it("falls back to string-inequality for non-semver", () => {
    expect(shouldUpgradePlugin("abc", "xyz")).toBe(true);
    expect(shouldUpgradePlugin("abc", "abc")).toBe(false);
  });
});

describe("plugin bundle version sync", () => {
  it("readBundledPluginVersion returns the bundled plugin.json version", async () => {
    const version = await readBundledPluginVersion();
    expect(version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("package.json and plugin.json versions stay in lockstep", async () => {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const repoRoot = path.resolve(__dirname, "..", "..");
    const pkgJson = JSON.parse(await fs.readFile(path.join(repoRoot, "package.json"), "utf-8"));
    const pluginJson = JSON.parse(
      await fs.readFile(
        path.join(repoRoot, "plugins", "claude-code", ".claude-plugin", "plugin.json"),
        "utf-8",
      ),
    );
    expect(pluginJson.version).toBe(pkgJson.version);
  });
});
