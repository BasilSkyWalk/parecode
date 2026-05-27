import { ToolHost } from "../adapters/base.js";
import { findFuzzyMatch } from "./fuzzy.js";

export type EditRequest = {
  edits: Array<{
    file: string;
    oldString: string;
    newString: string;
    fuzzy?: boolean | string;
  }>;
};

export type EditResult = {
  file: string;
  status: "success" | "error" | "conflict" | "fuzzy_match_failed";
  confidence?: number;
  matchedText?: string;
  detail?: string;
};

export class EditEngine {
  constructor(private host: ToolHost) {}

  public async edit(request: EditRequest): Promise<{ results: EditResult[] }> {
    const results: EditResult[] = [];

    for (const edit of request.edits) {
      try {
        const stats = await this.host.statFile(edit.file);
        
        let content = await this.host.readFile(edit.file);
        
        const count = content.split(edit.oldString).length - 1;
        if (count === 1) {
          content = content.replace(edit.oldString, edit.newString);
          await this.host.writeFile(edit.file, content);
          
          results.push({
            file: edit.file,
            status: "success",
            detail: `File stat successful: mtimeMs=${stats.mtimeMs}, size=${stats.size}`
          });
          continue;
        }

        if (count > 1) {
          results.push({
            file: edit.file,
            status: "error",
            detail: "Multiple occurrences of exact match found"
          });
          continue;
        }

        if (edit.fuzzy) {
          const aggressive = edit.fuzzy === "aggressive";
          const match = findFuzzyMatch(content, edit.oldString, aggressive);
          
          if (match) {
            content = content.substring(0, match.startIndex) + edit.newString + content.substring(match.endIndex);
            await this.host.writeFile(edit.file, content);
            results.push({
              file: edit.file,
              status: "success",
              confidence: match.confidence,
              matchedText: match.matchedText,
              detail: `File stat successful: mtimeMs=${stats.mtimeMs}, size=${stats.size}`
            });
            continue;
          } else {
            results.push({
              file: edit.file,
              status: "fuzzy_match_failed",
              detail: "Fuzzy match confidence below threshold or no match found"
            });
            continue;
          }
        }

        results.push({
          file: edit.file,
          status: "error",
          detail: "Exact match not found"
        });
      } catch (error) {
        const err = error as Error;
        results.push({
          file: edit.file,
          status: "error",
          detail: err.message
        });
      }
    }

    return { results };
  }
}
