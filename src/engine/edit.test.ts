import { describe, it, expect, vi } from "vitest";
import { EditEngine } from "./edit.js";
import { ToolHost } from "../adapters/base.js";

describe("EditEngine", () => {
  it("should retrieve pre-edit stat for the file", async () => {
    const mockHost: ToolHost = {
      registerTool: vi.fn(),
      readFile: vi.fn().mockResolvedValue("foo"),
      writeFile: vi.fn().mockResolvedValue(undefined),
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
      writeFile: vi.fn(),
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

  it("should apply exact match edit successfully", async () => {
    const mockHost: ToolHost = {
      registerTool: vi.fn(),
      readFile: vi.fn().mockResolvedValue("const a = 1;\nconst b = 2;\n"),
      writeFile: vi.fn().mockResolvedValue(undefined),
      log: vi.fn(),
      recordStat: vi.fn(),
      exec: vi.fn(),
      resolveCommand: vi.fn(),
      statFile: vi.fn().mockResolvedValue({ mtimeMs: 123, size: 456 }),
    };

    const engine = new EditEngine(mockHost);
    const result = await engine.edit({
      edits: [
        {
          file: "test.ts",
          oldString: "const a = 1;",
          newString: "const a = 42;"
        }
      ]
    });

    expect(mockHost.readFile).toHaveBeenCalledWith("test.ts");
    expect(mockHost.writeFile).toHaveBeenCalledWith("test.ts", "const a = 42;\nconst b = 2;\n");
    expect(result.results[0].status).toBe("success");
  });

  it("should return error if exact match fails", async () => {
    const mockHost: ToolHost = {
      registerTool: vi.fn(),
      readFile: vi.fn().mockResolvedValue("const a = 1;\n"),
      writeFile: vi.fn().mockResolvedValue(undefined),
      log: vi.fn(),
      recordStat: vi.fn(),
      exec: vi.fn(),
      resolveCommand: vi.fn(),
      statFile: vi.fn().mockResolvedValue({ mtimeMs: 123, size: 456 }),
    };

    const engine = new EditEngine(mockHost);
    const result = await engine.edit({
      edits: [
        {
          file: "test.ts",
          oldString: "const b = 1;",
          newString: "const b = 2;"
        }
      ]
    });

    expect(mockHost.writeFile).not.toHaveBeenCalled();
    expect(result.results[0].status).toBe("error");
    expect(result.results[0].detail).toContain("Exact match not found");
  });

  it("should return error if exact match has multiple occurrences", async () => {
    const mockHost: ToolHost = {
      registerTool: vi.fn(),
      readFile: vi.fn().mockResolvedValue("foo\nfoo\n"),
      writeFile: vi.fn(),
      log: vi.fn(),
      recordStat: vi.fn(),
      exec: vi.fn(),
      resolveCommand: vi.fn(),
      statFile: vi.fn().mockResolvedValue({ mtimeMs: 123, size: 456 }),
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

    expect(mockHost.writeFile).not.toHaveBeenCalled();
    expect(result.results[0].status).toBe("error");
    expect(result.results[0].detail).toContain("Multiple occurrences of exact match found");
  });
});
