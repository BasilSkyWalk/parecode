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

  it("should apply fuzzy match successfully if enabled", async () => {
    const mockHost: ToolHost = {
      registerTool: vi.fn(),
      readFile: vi.fn().mockResolvedValue("const   a  = \n 1;\nconst b = 2;\n"),
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
          newString: "const a = 42;",
          fuzzy: true
        }
      ]
    });

    expect(mockHost.writeFile).toHaveBeenCalledWith("test.ts", "const a = 42;\nconst b = 2;\n");
    expect(result.results[0].status).toBe("success");
    expect(result.results[0].confidence).toBe(1.0);
    expect(result.results[0].matchedText).toBe("const   a  = \n 1;");
  });

  it("should fail closed if fuzzy match confidence is too low", async () => {
    const mockHost: ToolHost = {
      registerTool: vi.fn(),
      readFile: vi.fn().mockResolvedValue("const myVar = 1;\n"),
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
          oldString: "const yourVar = 1;",
          newString: "const yourVar = 42;",
          fuzzy: true
        }
      ]
    });

    expect(mockHost.writeFile).not.toHaveBeenCalled();
    expect(result.results[0].status).toBe("fuzzy_match_failed");
  });

  it("should process multiple edits in the same file sequentially and write once", async () => {
    const mockHost: ToolHost = {
      registerTool: vi.fn(),
      readFile: vi.fn().mockResolvedValue("let a = 1;\nlet b = 2;\n"),
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
          oldString: "let a = 1;",
          newString: "let a = 10;"
        },
        {
          file: "test.ts",
          oldString: "let b = 2;",
          newString: "let b = 20;"
        }
      ]
    });

    expect(mockHost.readFile).toHaveBeenCalledTimes(1);
    expect(mockHost.writeFile).toHaveBeenCalledTimes(1);
    expect(mockHost.writeFile).toHaveBeenCalledWith("test.ts", "let a = 10;\nlet b = 20;\n");
    expect(result.results.length).toBe(1);
    expect(result.results[0].status).toBe("success");
    expect(result.results[0].file).toBe("test.ts");
  });

  it("should fail the entire file if one edit fails but process other files successfully", async () => {
    const mockHost: ToolHost = {
      registerTool: vi.fn(),
      readFile: vi.fn().mockImplementation(async (file: string) => {
        if (file === "test1.ts") return "let a = 1;\nlet b = 2;\n";
        if (file === "test2.ts") return "let c = 3;\n";
        return "";
      }),
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
          file: "test1.ts",
          oldString: "let a = 1;",
          newString: "let a = 10;"
        },
        {
          file: "test1.ts",
          oldString: "let z = 99;",
          newString: "let z = 100;"
        },
        {
          file: "test2.ts",
          oldString: "let c = 3;",
          newString: "let c = 30;"
        }
      ]
    });

    expect(result.results.length).toBe(2);
    
    const res1 = result.results.find(r => r.file === "test1.ts");
    expect(res1?.status).toBe("error");
    
    const res2 = result.results.find(r => r.file === "test2.ts");
    expect(res2?.status).toBe("success");
    
    expect(mockHost.writeFile).toHaveBeenCalledTimes(1);
    expect(mockHost.writeFile).toHaveBeenCalledWith("test2.ts", "let c = 30;\n");
  });
});
