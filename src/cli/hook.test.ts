import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { hookCommand } from "./hook.js";

describe("hookCommand", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit:${code ?? 0}`);
    }) as never);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("emits a SessionStart hookSpecificOutput payload with additionalContext", async () => {
    await hookCommand(["session-start"]);

    expect(stdoutSpy).toHaveBeenCalledOnce();
    const written = stdoutSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(written);
    expect(parsed.hookSpecificOutput.hookEventName).toBe("SessionStart");
    expect(parsed.hookSpecificOutput.additionalContext).toMatch(/ParecodeSearch/);
    expect(parsed.hookSpecificOutput.additionalContext).toMatch(/ParecodeEdit/);
    expect(parsed.hookSpecificOutput.additionalContext).toMatch(/#no-parecode/);
  });

  it("exits non-zero on unknown subcommand", async () => {
    await expect(hookCommand(["bogus"])).rejects.toThrow("exit:1");
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("Unknown hook subcommand"));
  });

  it("exits non-zero on missing subcommand", async () => {
    await expect(hookCommand([])).rejects.toThrow("exit:1");
  });
});
