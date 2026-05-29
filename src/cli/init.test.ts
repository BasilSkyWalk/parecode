import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { dir } from "tmp-promise";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { initCommand } from "./init.js";

const defaultSpawnImpl = async (_cmd: string, args: string[]) => {
  if (args[0] === "mcp" && args[1] === "get") {
    return { stdout: "", stderr: "", code: 1 };
  }
  return { stdout: "", stderr: "", code: 0 };
};

vi.mock("../infra/spawn.js", () => ({
  resolveCommand: vi.fn().mockResolvedValue("/usr/bin/claude"),
  spawnCommand: vi.fn(),
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
    const { spawnCommand } = await import("../infra/spawn.js");
    vi.mocked(spawnCommand).mockReset();
    vi.mocked(spawnCommand).mockImplementation(defaultSpawnImpl);
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

    await initCommand(["--scope", "user", "--with-hook", "--no-aggressive-hook"]);

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

  it("installs the SessionStart hook by default with no hook flag", async () => {
    await initCommand(["--scope", "user"]);

    const settingsPath = path.join(configDir, "settings.json");
    const settings = JSON.parse(await fs.readFile(settingsPath, "utf-8"));
    expect(settings.hooks.SessionStart).toHaveLength(1);
    expect(settings.hooks.SessionStart[0].hooks[0].command).toBe("npx parecode hook session-start");
  });

  it("names the opt-out flag in the install message when the hook is installed by default", async () => {
    await initCommand(["--scope", "user"]);

    const printed = stdoutSpy.mock.calls.map((c: unknown[]) => c[0] as string).join("");
    expect(printed).toContain("Installed SessionStart hook");
    expect(printed).toContain("--no-hook");
  });

  it("does not name the opt-out flag when the hook is installed via explicit --with-hook", async () => {
    await initCommand(["--scope", "user", "--with-hook"]);

    const printed = stdoutSpy.mock.calls.map((c: unknown[]) => c[0] as string).join("");
    expect(printed).toContain("Installed SessionStart hook");
    expect(printed).not.toContain("--no-hook");
  });

  it("--no-hook skips hook installation entirely", async () => {
    await initCommand(["--scope", "user", "--no-hook"]);

    const settingsPath = path.join(configDir, "settings.json");
    await expect(fs.access(settingsPath)).rejects.toThrow();
  });

  it("--no-hook leaves an existing hook untouched (use --remove-hook to remove)", async () => {
    await initCommand(["--scope", "user", "--with-hook"]);
    await initCommand(["--scope", "user", "--no-hook"]);

    const settingsPath = path.join(configDir, "settings.json");
    const settings = JSON.parse(await fs.readFile(settingsPath, "utf-8"));
    expect(settings.hooks.SessionStart).toHaveLength(1);
  });

  it("prints a nudge to run the retroactive scan at the end", async () => {
    await initCommand(["--scope", "user"]);
    const printed = stdoutSpy.mock.calls.map((c: unknown[]) => c[0] as string).join("");
    expect(printed).toContain("Tip: Run 'parecode stats --retroactive'");
  });

  it("--with-plugin adds the marketplace and installs the plugin", async () => {
    const { spawnCommand } = await import("../infra/spawn.js");
    await initCommand(["--scope", "user", "--with-plugin"]);
    expect(spawnCommand).toHaveBeenCalledWith(
      "/usr/bin/claude",
      ["plugin", "marketplace", "add", expect.stringMatching(/github\.com\/BasilSkyWalk\/parecode/)]
    );
    expect(spawnCommand).toHaveBeenCalledWith(
      "/usr/bin/claude",
      ["plugin", "install", "parecode-explore@parecode", "-s", "user"]
    );
  });

  it("--with-plugin --linked points marketplace add at the local repo path", async () => {
    const { spawnCommand } = await import("../infra/spawn.js");
    await initCommand(["--scope", "user", "--with-plugin", "--linked"]);
    const marketplaceCalls = vi.mocked(spawnCommand).mock.calls.filter(
      ([, args]) => Array.isArray(args) && args[1] === "marketplace" && args[2] === "add",
    );
    expect(marketplaceCalls).toHaveLength(1);
    const sourceArg = marketplaceCalls[0][1][3] as string;
    expect(path.isAbsolute(sourceArg)).toBe(true);
    expect(sourceArg).not.toContain("github.com");
  });

  it("--with-plugin skips marketplace add when already configured", async () => {
    const { spawnCommand } = await import("../infra/spawn.js");
    vi.mocked(spawnCommand).mockImplementation(async (_cmd: string, args: string[]) => {
      if (args[0] === "mcp" && args[1] === "get") return { stdout: "", stderr: "", code: 1 };
      if (args[0] === "plugin" && args[1] === "marketplace" && args[2] === "list") {
        return { stdout: "  ❯ parecode\n    Source: Directory (/x)\n", stderr: "", code: 0 };
      }
      return { stdout: "", stderr: "", code: 0 };
    });
    await initCommand(["--scope", "user", "--with-plugin"]);
    expect(spawnCommand).not.toHaveBeenCalledWith(
      "/usr/bin/claude",
      expect.arrayContaining(["plugin", "marketplace", "add"])
    );
    const printed = stdoutSpy.mock.calls.map((c: unknown[]) => c[0] as string).join("");
    expect(printed).toContain("Parecode marketplace already configured");
  });

  it("--with-plugin skips install when plugin already present", async () => {
    const { spawnCommand } = await import("../infra/spawn.js");
    vi.mocked(spawnCommand).mockImplementation(async (_cmd: string, args: string[]) => {
      if (args[0] === "mcp" && args[1] === "get") return { stdout: "", stderr: "", code: 1 };
      if (args[0] === "plugin" && args[1] === "marketplace" && args[2] === "list") {
        return { stdout: "  ❯ parecode\n", stderr: "", code: 0 };
      }
      if (args[0] === "plugin" && args[1] === "list") {
        return { stdout: "  ❯ parecode-explore@parecode\n", stderr: "", code: 0 };
      }
      return { stdout: "", stderr: "", code: 0 };
    });
    await initCommand(["--scope", "user", "--with-plugin"]);
    expect(spawnCommand).not.toHaveBeenCalledWith(
      "/usr/bin/claude",
      expect.arrayContaining(["plugin", "install"])
    );
    const printed = stdoutSpy.mock.calls.map((c: unknown[]) => c[0] as string).join("");
    expect(printed).toContain("Parecode plugin already installed");
  });

  it("--remove-plugin invokes claude plugin uninstall if present", async () => {
    const { spawnCommand } = await import("../infra/spawn.js");
    vi.mocked(spawnCommand).mockImplementation(async (_cmd: string, args: string[]) => {
      if (args[0] === "mcp" && args[1] === "get") return { stdout: "", stderr: "", code: 1 };
      if (args[0] === "plugin" && args[1] === "list") {
        return { stdout: "  ❯ parecode-explore@parecode\n", stderr: "", code: 0 };
      }
      return { stdout: "", stderr: "", code: 0 };
    });
    await initCommand(["--scope", "user", "--remove-plugin"]);
    expect(spawnCommand).toHaveBeenCalledWith(
      "/usr/bin/claude",
      ["plugin", "uninstall", "parecode-explore", "-s", "user"]
    );
  });

  it("--remove-plugin skips uninstall if not present", async () => {
    const { spawnCommand } = await import("../infra/spawn.js");
    await initCommand(["--scope", "user", "--remove-plugin"]);
    expect(spawnCommand).not.toHaveBeenCalledWith(
      "/usr/bin/claude",
      ["plugin", "uninstall", "parecode-explore", "-s", "user"]
    );
    const printed = stdoutSpy.mock.calls.map((c: unknown[]) => c[0] as string).join("");
    expect(printed).toContain("No Parecode plugin found");
  });

  it("--remove-plugin --print describes the removal without invoking claude", async () => {
    const { spawnCommand } = await import("../infra/spawn.js");
    await initCommand(["--scope", "user", "--remove-plugin", "--print"]);
    expect(spawnCommand).not.toHaveBeenCalled();
    const printed = stdoutSpy.mock.calls.map((c: unknown[]) => c[0] as string).join("");
    expect(printed).toContain("claude plugin uninstall parecode-explore");
  });

  it("--with-plugin --print describes both marketplace add and install", async () => {
    const { spawnCommand } = await import("../infra/spawn.js");
    await initCommand(["--scope", "user", "--with-plugin", "--print"]);
    expect(spawnCommand).not.toHaveBeenCalled();
    const printed = stdoutSpy.mock.calls.map((c: unknown[]) => c[0] as string).join("");
    expect(printed).toContain("claude plugin marketplace add");
    expect(printed).toContain("claude plugin install parecode-explore@parecode");
  });

  it("installs the plugin by default with no plugin flag", async () => {
    const { spawnCommand } = await import("../infra/spawn.js");
    await initCommand(["--scope", "user"]);
    expect(spawnCommand).toHaveBeenCalledWith(
      "/usr/bin/claude",
      ["plugin", "install", "parecode-explore@parecode", "-s", "user"]
    );
  });

  it("names the opt-out flag in the install message when the plugin is installed by default", async () => {
    await initCommand(["--scope", "user"]);
    const printed = stdoutSpy.mock.calls.map((c: unknown[]) => c[0] as string).join("");
    expect(printed).toContain("Installed Parecode plugin");
    expect(printed).toContain("--no-plugin");
  });

  it("does not name the opt-out flag when the plugin is installed via explicit --with-plugin", async () => {
    await initCommand(["--scope", "user", "--with-plugin"]);
    const printed = stdoutSpy.mock.calls.map((c: unknown[]) => c[0] as string).join("");
    expect(printed).toContain("Installed Parecode plugin");
    expect(printed).not.toContain("--no-plugin");
  });

  it("--no-plugin skips plugin install entirely", async () => {
    const { spawnCommand } = await import("../infra/spawn.js");
    await initCommand(["--scope", "user", "--no-plugin"]);
    expect(spawnCommand).not.toHaveBeenCalledWith(
      "/usr/bin/claude",
      expect.arrayContaining(["plugin", "marketplace", "list"])
    );
    expect(spawnCommand).not.toHaveBeenCalledWith(
      "/usr/bin/claude",
      expect.arrayContaining(["plugin", "install"])
    );
  });

  it("default plugin install soft-fails when claude plugin commands fail", async () => {
    const { spawnCommand } = await import("../infra/spawn.js");
    vi.mocked(spawnCommand).mockImplementation(async (_cmd: string, args: string[]) => {
      if (args[0] === "mcp" && args[1] === "get") return { stdout: "", stderr: "", code: 1 };
      if (args[0] === "plugin") return { stdout: "", stderr: "unknown command: plugin", code: 1 };
      return { stdout: "", stderr: "", code: 0 };
    });
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await expect(initCommand(["--scope", "user"])).resolves.toBeUndefined();
    const erred = stderrSpy.mock.calls.map((c: unknown[]) => c[0] as string).join("");
    expect(erred).toContain("Warning");
    expect(erred).toContain("--with-plugin");
    stderrSpy.mockRestore();
  });

  it("explicit --with-plugin still hard-fails when claude plugin commands fail", async () => {
    const { spawnCommand } = await import("../infra/spawn.js");
    vi.mocked(spawnCommand).mockImplementation(async (_cmd: string, args: string[]) => {
      if (args[0] === "mcp" && args[1] === "get") return { stdout: "", stderr: "", code: 1 };
      if (args[0] === "plugin") return { stdout: "", stderr: "unknown command: plugin", code: 1 };
      return { stdout: "", stderr: "", code: 0 };
    });
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await expect(initCommand(["--scope", "user", "--with-plugin"])).rejects.toThrow(/exit:1/);
    stderrSpy.mockRestore();
  });
});
