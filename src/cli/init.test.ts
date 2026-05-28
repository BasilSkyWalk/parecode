import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { dir } from "tmp-promise";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { initCommand } from "./init.js";

vi.mock("../infra/spawn.js", () => ({
  resolveCommand: vi.fn().mockResolvedValue("/usr/bin/claude"),
  spawnCommand: vi.fn().mockImplementation(async (_cmd: string, args: string[]) => {
    if (args[0] === "mcp" && args[1] === "get") {
      return { stdout: "", stderr: "", code: 1 };
    }
    return { stdout: "", stderr: "", code: 0 };
  }),
}));

describe("initCommand --with-hook / --remove-hook", () => {
  let tmpHome: { path: string; cleanup: () => Promise<void> };
  let configDir: string;
  let originalConfigDir: string | undefined;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    tmpHome = await dir({ unsafeCleanup: true });
    configDir = path.join(tmpHome.path, ".claude");
    originalConfigDir = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = configDir;
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit:${code ?? 0}`);
    }) as never);
  });

  afterEach(async () => {
    if (originalConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = originalConfigDir;
    stdoutSpy.mockRestore();
    exitSpy.mockRestore();
    await tmpHome.cleanup();
  });

  it("writes a SessionStart hook entry to user settings.json when --with-hook is set", async () => {
    await initCommand(["--scope", "user", "--with-hook"]);

    const settingsPath = path.join(configDir, "settings.json");
    const raw = await fs.readFile(settingsPath, "utf-8");
    const settings = JSON.parse(raw);
    expect(settings.hooks.SessionStart).toHaveLength(1);
    expect(settings.hooks.SessionStart[0].hooks[0].command).toBe("npx parecode hook session-start");
  });

  it("uses the linked command in the hook entry when --linked is set", async () => {
    await initCommand(["--scope", "user", "--with-hook", "--linked"]);

    const settingsPath = path.join(configDir, "settings.json");
    const settings = JSON.parse(await fs.readFile(settingsPath, "utf-8"));
    expect(settings.hooks.SessionStart[0].hooks[0].command).toBe("parecode hook session-start");
  });

  it("is idempotent — does not create duplicate hook entries on repeat", async () => {
    await initCommand(["--scope", "user", "--with-hook"]);
    await initCommand(["--scope", "user", "--with-hook"]);

    const settingsPath = path.join(configDir, "settings.json");
    const settings = JSON.parse(await fs.readFile(settingsPath, "utf-8"));
    expect(settings.hooks.SessionStart).toHaveLength(1);
  });

  it("preserves unrelated settings when installing the hook", async () => {
    const settingsPath = path.join(configDir, "settings.json");
    await fs.mkdir(path.dirname(settingsPath), { recursive: true });
    await fs.writeFile(
      settingsPath,
      JSON.stringify({ theme: "dark", hooks: { PreToolUse: [{ matcher: "X" }] } }),
      "utf-8",
    );

    await initCommand(["--scope", "user", "--with-hook"]);

    const settings = JSON.parse(await fs.readFile(settingsPath, "utf-8"));
    expect(settings.theme).toBe("dark");
    expect(settings.hooks.PreToolUse).toEqual([{ matcher: "X" }]);
    expect(settings.hooks.SessionStart).toHaveLength(1);
  });

  it("removes only the Parecode hook entry on --remove-hook", async () => {
    await initCommand(["--scope", "user", "--with-hook"]);

    await initCommand(["--scope", "user", "--remove-hook"]);

    const settingsPath = path.join(configDir, "settings.json");
    const settings = JSON.parse(await fs.readFile(settingsPath, "utf-8"));
    expect(settings.hooks?.SessionStart).toBeUndefined();
  });

  it("--print --with-hook describes the hook but does not write settings", async () => {
    await initCommand(["--scope", "user", "--with-hook", "--print"]);

    const settingsPath = path.join(configDir, "settings.json");
    await expect(fs.access(settingsPath)).rejects.toThrow();
    const printed = stdoutSpy.mock.calls.map((c: unknown[]) => c[0] as string).join("");
    expect(printed).toContain("claude mcp add parecode");
    expect(printed).toContain("Would also install SessionStart hook");
  });
});
