import { describe, expect, it } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(here, "..");
const repoRoot = path.resolve(srcRoot, "..");
const installEscapeHatch = path.join(srcRoot, "infra", "install");

const bannedPackages = [
  "posthog-js",
  "posthog-node",
  "@sentry/node",
  "@sentry/browser",
  "mixpanel",
  "mixpanel-browser",
  "analytics-node",
  "@segment/analytics-node",
  "@amplitude/analytics-node",
  "amplitude-js",
  "datadog-metrics",
  "dd-trace",
  "@vercel/analytics",
  "update-notifier",
  "latest-version",
  "package-json",
  "npm-check-updates",
];

const bannedHostnames = [
  "registry.npmjs.org",
  "api.github.com",
  "app.posthog.com",
  "sentry.io",
  "api.mixpanel.com",
  "api.segment.io",
  "api.amplitude.com",
];

function importPattern(pkg: string): RegExp {
  const escaped = pkg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`from\\s+['"]${escaped}(/[^'"]*)?['"]|require\\(\\s*['"]${escaped}(/[^'"]*)?['"]\\s*\\)`);
}

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

describe("no telemetry / no version-check guarantee", () => {
  it("source has no telemetry or version-check imports", async () => {
    const files = await collectSourceFiles(srcRoot);
    const offenders: string[] = [];
    for (const file of files) {
      const body = await readFile(file, "utf8");
      for (const pkg of bannedPackages) {
        if (importPattern(pkg).test(body)) {
          offenders.push(`${path.relative(srcRoot, file)} — imports ${pkg}`);
        }
      }
      for (const host of bannedHostnames) {
        if (body.includes(host)) {
          offenders.push(`${path.relative(srcRoot, file)} — references ${host}`);
        }
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("package.json has no telemetry or version-check dependencies", async () => {
    const raw = await readFile(path.join(repoRoot, "package.json"), "utf8");
    const pkg = JSON.parse(raw) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
    };
    const allDeps = {
      ...(pkg.dependencies ?? {}),
      ...(pkg.devDependencies ?? {}),
      ...(pkg.optionalDependencies ?? {}),
    };
    const offenders = bannedPackages.filter((p) => p in allDeps);
    expect(offenders, offenders.join(", ")).toEqual([]);
  });
});
