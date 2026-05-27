import { describe, it, expect } from "vitest";
import { ASTProcessor } from "./ast.js";

describe("ASTProcessor", () => {
  it("should truncate function and method bodies", () => {
    const processor = new ASTProcessor();
    const code = `
      /** Docstring */
      export function foo(a: string, b: number): boolean {
        const c = a + b;
        return true;
      }
      
      class Bar {
        method1() {
          console.log("hello");
        }
      }
      
      const baz = (x: number) => x * 2;
    `;
    
    const result = processor.process(code, { truncate: "signatures" });
    expect(result.degraded).toBeFalsy();
    expect(result.content).toContain("export function foo(a: string, b: number): boolean { /* truncated */ }");
    expect(result.content).toContain("method1() { /* truncated */ }");
    expect(result.content).toContain("const baz = (x: number) => { /* truncated */ };");
  });

  it("should set degraded to true for malformed files", () => {
    const processor = new ASTProcessor();
    const code = `
      function foo() {
        return;
      // Missing closing brace
    `;
    
    const result = processor.process(code, { truncate: "signatures" });
    expect(result.degraded).toBe(true);
    expect(result.content).toBe(code);
  });

  it("should return content unchanged if truncate is 'none'", () => {
    const processor = new ASTProcessor();
    const code = `function foo() { return 1; }`;
    const result = processor.process(code, { truncate: "none" });
    expect(result.content).toBe(code);
    expect(result.degraded).toBeFalsy();
  });
});
