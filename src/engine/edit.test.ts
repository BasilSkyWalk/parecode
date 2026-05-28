import { describe, it, expect, vi } from "vitest";
import { dir } from "tmp-promise";
import fs from "fs/promises";
import path from "path";
import fc from "fast-check";
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

  it("should return conflict if file is modified between read and write", async () => {
    const statMock = vi.fn()
      .mockResolvedValueOnce({ mtimeMs: 100, size: 456 })
      .mockResolvedValueOnce({ mtimeMs: 200, size: 456 });

    const mockHost: ToolHost = {
      registerTool: vi.fn(),
      readFile: vi.fn().mockResolvedValue("let a = 1;"),
      writeFile: vi.fn().mockResolvedValue(undefined),
      log: vi.fn(),
      recordStat: vi.fn(),
      exec: vi.fn(),
      resolveCommand: vi.fn(),
      statFile: statMock,
    };

    const engine = new EditEngine(mockHost);
    const result = await engine.edit({
      edits: [
        {
          file: "test.ts",
          oldString: "let a = 1;",
          newString: "let a = 10;"
        }
      ]
    });

    expect(mockHost.writeFile).not.toHaveBeenCalled();
    expect(result.results.length).toBe(1);
    expect(result.results[0].status).toBe("conflict");
    expect(result.results[0].detail).toBe("File modified by another process during edit");
  });

  describe("property tests", () => {
    it("should round-trip exact edits on real file system", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 5 }),
          fc.integer({ min: 0, max: 4 }),
          fc.integer({ min: 1, max: 4 }),
          fc.string(),
          async (content, startIdx, length, newString) => {
            fc.pre(startIdx + length <= content.length);
            const oldString = content.substring(startIdx, startIdx + length);
            
            const count = content.split(oldString).length - 1;
            fc.pre(count === 1);
            
            const { path: dirPath, cleanup } = await dir({ unsafeCleanup: true });
            const filePath = path.join(dirPath, "test.txt");
            await fs.writeFile(filePath, content, "utf-8");
            
            const realHost: ToolHost = {
              registerTool: vi.fn(),
              readFile: async (p) => fs.readFile(p, "utf-8"),
              writeFile: async (p, c) => fs.writeFile(p, c, "utf-8"),
              log: vi.fn(),
              recordStat: vi.fn(),
              exec: vi.fn(),
              resolveCommand: vi.fn(),
              statFile: async (p) => {
                const s = await fs.stat(p);
                return { mtimeMs: s.mtimeMs, size: s.size };
              },
            };
            
            const engine = new EditEngine(realHost);
            const result = await engine.edit({
              edits: [
                {
                  file: filePath,
                  oldString,
                  newString
                }
              ]
            });
            
            expect(result.results[0].status).toBe("success");
            const newContent = await fs.readFile(filePath, "utf-8");
            const expectedContent = content.substring(0, startIdx) + newString + content.substring(startIdx + length);
            expect(newContent).toBe(expectedContent);
            
            await cleanup();
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
