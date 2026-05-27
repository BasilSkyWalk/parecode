import { describe, it, expect, vi } from "vitest";
import { EditEngine } from "./edit.js";
import { ToolHost } from "../adapters/base.js";

describe("EditEngine", () => {
  it("should retrieve pre-edit stat for the file", async () => {
    const mockHost: ToolHost = {
      registerTool: vi.fn(),
      readFile: vi.fn(),
      log: vi.fn(),
      recordStat: vi.fn(),
      exec: vi.fn(),
      resolveCommand: vi.fn(),
      statFile: vi.fn().mockResolvedValue({ mtimeMs: 12345, size: 678 }),
    };

    const engine = new EditEngine(mockHost);
    const result = await engine.edit({
      edits: [
        {
          file: "test.ts",
          oldString: "foo",
          newString: "bar"
        }
      ]
    });

    expect(mockHost.statFile).toHaveBeenCalledWith("test.ts");
    expect(result.results[0].status).toBe("success");
    expect(result.results[0].detail).toContain("mtimeMs=12345");
  });

  it("should return error status if statFile fails", async () => {
    const mockHost: ToolHost = {
      registerTool: vi.fn(),
      readFile: vi.fn(),
      log: vi.fn(),
      recordStat: vi.fn(),
      exec: vi.fn(),
      resolveCommand: vi.fn(),
      statFile: vi.fn().mockRejectedValue(new Error("ENOENT: no such file or directory")),
    };

    const engine = new EditEngine(mockHost);
    const result = await engine.edit({
      edits: [
        {
          file: "missing.ts",
          oldString: "foo",
          newString: "bar"
        }
      ]
    });

    expect(result.results[0].status).toBe("error");
    expect(result.results[0].detail).toContain("ENOENT");
  });
});
