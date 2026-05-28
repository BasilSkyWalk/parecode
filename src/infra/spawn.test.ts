import { describe, it, expect, vi, afterEach } from "vitest";
import { spawnCommand, resolveCommand } from "./spawn.js";
import * as os from "node:os";
import * as cp from "node:child_process";
import { EventEmitter } from "node:events";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawn: vi.fn(actual.spawn),
  };
});

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return {
    ...actual,
    platform: vi.fn(actual.platform),
  };
});

describe("spawn infra", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resolves basic commands", async () => {
    const nodePath = await resolveCommand("node");
    expect(nodePath).toBeTruthy();
    expect(typeof nodePath).toBe("string");
  });

  it("handles commands with arguments containing spaces without shell interpolation", async () => {
    const nodePath = await resolveCommand("node");
    expect(nodePath).toBeTruthy();

    const script = `console.log(process.argv[1]);`;
    const spaceArg = "path with spaces/and quotes'";

    const result = await spawnCommand(nodePath!, ["-e", script, spaceArg]);
    
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe(spaceArg);
  });

  it("extracts the first path when Windows where command returns multiple lines", async () => {
    vi.mocked(os.platform).mockReturnValue("win32");
    
    const mockProc = new EventEmitter() as any;
    mockProc.stdout = new EventEmitter();
    mockProc.stderr = new EventEmitter();
    
    vi.mocked(cp.spawn).mockReturnValueOnce(mockProc);
    
    const resolvePromise = resolveCommand("rg");
    
    mockProc.stdout.emit("data", "C:\\Program Files\\rg.exe\r\nC:\\Windows\\rg.exe\r\n");
    mockProc.emit("close", 0);
    
    const result = await resolvePromise;
    expect(result).toBe("C:\\Program Files\\rg.exe");
    expect(cp.spawn).toHaveBeenCalledWith("where", ["rg"]);
  });
});
