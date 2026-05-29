import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Readable } from "node:stream";
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

  describe("pre-tool-use", () => {
    const originalStdin = process.stdin;

    function feedStdin(input: string) {
      const stream = Readable.from([input]) as unknown as NodeJS.ReadStream;
      Object.defineProperty(stream, "isTTY", { value: false });
      Object.defineProperty(process, "stdin", { configurable: true, value: stream });
    }

    afterEach(() => {
      Object.defineProperty(process, "stdin", { configurable: true, value: originalStdin });
    });

    it("denies Grep with a redirect message", async () => {
      feedStdin(JSON.stringify({ tool_name: "Grep", tool_input: { pattern: "foo" } }));
      await hookCommand(["pre-tool-use"]);
      const out = JSON.parse(stdoutSpy.mock.calls[0][0] as string);
      expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
      expect(out.hookSpecificOutput.permissionDecisionReason).toMatch(/ParecodeSearch/);
    });

    it("denies Glob with a redirect message", async () => {
      feedStdin(JSON.stringify({ tool_name: "Glob", tool_input: { pattern: "**/*.ts" } }));
      await hookCommand(["pre-tool-use"]);
      const out = JSON.parse(stdoutSpy.mock.calls[0][0] as string);
      expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
      expect(out.hookSpecificOutput.permissionDecisionReason).toMatch(/ParecodeSearch/);
    });

    it("allows other tools through", async () => {
      feedStdin(JSON.stringify({ tool_name: "Bash", tool_input: { command: "ls" } }));
      await hookCommand(["pre-tool-use"]);
      const out = JSON.parse(stdoutSpy.mock.calls[0][0] as string);
      expect(out.hookSpecificOutput.permissionDecision).toBe("allow");
    });

    it("denies Bash grep with a redirect message", async () => {
      feedStdin(JSON.stringify({ tool_name: "Bash", tool_input: { command: "grep -nE 'foo|bar' src/x.lua" } }));
      await hookCommand(["pre-tool-use"]);
      const out = JSON.parse(stdoutSpy.mock.calls[0][0] as string);
      expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
      expect(out.hookSpecificOutput.permissionDecisionReason).toMatch(/ParecodeSearch/);
    });

    it("denies Bash rg / ripgrep", async () => {
      for (const cmd of ["rg foo src/", "ripgrep --json bar"]) {
        feedStdin(JSON.stringify({ tool_name: "Bash", tool_input: { command: cmd } }));
        await hookCommand(["pre-tool-use"]);
        const out = JSON.parse(stdoutSpy.mock.calls.at(-1)![0] as string);
        expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
      }
    });

    it("denies Bash piped grep (cat foo | grep bar)", async () => {
      feedStdin(JSON.stringify({ tool_name: "Bash", tool_input: { command: "cat src/x.lua | grep -nE foo" } }));
      await hookCommand(["pre-tool-use"]);
      const out = JSON.parse(stdoutSpy.mock.calls[0][0] as string);
      expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
    });

    it("does NOT flag commands that merely contain the substring 'grep'", async () => {
      for (const cmd of ["ls /usr/local/lib/grepkit", "echo 'no grep here'", "npm ls --depth=0"]) {
        feedStdin(JSON.stringify({ tool_name: "Bash", tool_input: { command: cmd } }));
        await hookCommand(["pre-tool-use"]);
        const out = JSON.parse(stdoutSpy.mock.calls.at(-1)![0] as string);
        expect(out.hookSpecificOutput.permissionDecision).toBe("allow");
      }
    });

    it("allows when stdin is empty / malformed", async () => {
      feedStdin("not-json");
      await hookCommand(["pre-tool-use"]);
      const out = JSON.parse(stdoutSpy.mock.calls[0][0] as string);
      expect(out.hookSpecificOutput.permissionDecision).toBe("allow");
    });
  });
});
