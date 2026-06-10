import { describe, it, expect, vi } from "vitest";
import path from "node:path";
import { updateCommand, UpdateIo } from "./update.js";

function makeIo(overrides: Partial<UpdateIo> = {}): UpdateIo & { out: string[]; err: string[]; runs: string[][] } {
  const out: string[] = [];
  const err: string[] = [];
  const runs: string[][] = [];
  const versions = ["0.6.3", "0.8.0"];
  return {
    out,
    err,
    runs,
    packageRoot: vi.fn().mockResolvedValue("/g/lib/node_modules/parecode"),
    readVersion: vi.fn().mockImplementation(async () => versions.shift() ?? "0.8.0"),
    exec: vi.fn().mockResolvedValue({ stdout: "/g/lib/node_modules\n", code: 0 }),
    runInherit: vi.fn().mockImplementation(async (cmd: string, args: string[]) => {
      runs.push([cmd, ...args]);
      return 0;
    }),
    stdout: (msg: string) => out.push(msg),
    stderr: (msg: string) => err.push(msg),
    ...overrides,
  };
}

describe("updateCommand", () => {
  it("installs latest, re-runs init from the new install, and reports the version change", async () => {
    const io = makeIo();

    const code = await updateCommand([], io);

    expect(code).toBe(0);
    expect(io.runs[0]).toEqual(["npm", "install", "-g", "parecode@latest"]);
    expect(io.runs[1][1]).toBe(path.join("/g/lib/node_modules/parecode", "dist/cli/index.js"));
    expect(io.runs[1][2]).toBe("init");
    expect(io.out.join("\n")).toContain("0.6.3 → 0.8.0");
  });

  it("refuses with manual instructions when not an npm global install", async () => {
    const io = makeIo({
      packageRoot: vi.fn().mockResolvedValue("/Users/x/.npm/_npx/abc123/node_modules/parecode"),
    });

    const code = await updateCommand([], io);

    expect(code).toBe(1);
    expect(io.runs).toEqual([]);
    expect(io.err.join("\n")).toContain("npm install -g parecode@latest");
  });

  it("propagates npm install failure without running init", async () => {
    const io = makeIo({
      runInherit: vi.fn().mockResolvedValue(1),
    });

    const code = await updateCommand([], io);

    expect(code).toBe(1);
    expect(io.runInherit).toHaveBeenCalledTimes(1);
  });
});
