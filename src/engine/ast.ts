import Parser from "tree-sitter";
import ts from "tree-sitter-typescript";

export interface ASTProcessorOptions {
  truncate: "none" | "signatures" | "full";
  language?: "typescript"; // Hardcoded TS-only for prototype
}

export interface ASTProcessorResult {
  content: string;
  degraded?: boolean;
}

export class ASTProcessor {
  private parser: Parser;
  private signaturesQuery: Parser.Query;

  constructor() {
    this.parser = new Parser();
    this.parser.setLanguage(ts.typescript);

    const queryString = `
      (function_declaration body: (statement_block) @body)
      (method_definition body: (statement_block) @body)
      (arrow_function body: (_) @body)
    `;
    this.signaturesQuery = new Parser.Query(ts.typescript, queryString);
  }

  public process(content: string, options: ASTProcessorOptions): ASTProcessorResult {
    if (options.truncate === "none") {
      return { content };
    }

    if (options.truncate === "signatures") {
      try {
        const tree = this.parser.parse(content);
        if (tree.rootNode.hasError) {
          return { content, degraded: true };
        }

        const matches = this.signaturesQuery.matches(tree.rootNode);
        
        // Collect all captures to replace
        const captures = [];
        for (const match of matches) {
          for (const capture of match.captures) {
            captures.push(capture);
          }
        }

        // Sort by startIndex descending to replace from bottom to top
        captures.sort((a, b) => b.node.startIndex - a.node.startIndex);

        let result = content;
        for (const capture of captures) {
          const start = capture.node.startIndex;
          const end = capture.node.endIndex;
          result = result.slice(0, start) + "{ /* truncated */ }" + result.slice(end);
        }

        return { content: result };
      } catch (e) {
        return { content, degraded: true };
      }
    }

    // fallback for 'full' or unhandled
    return { content };
  }
}
