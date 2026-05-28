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
    const editsByFile = new Map<string, EditRequest["edits"]>();
    for (const edit of request.edits) {
      const list = editsByFile.get(edit.file) || [];
      list.push(edit);
      editsByFile.set(edit.file, list);
    }

    const filePromises = Array.from(editsByFile.entries()).map(async ([file, edits]) => {
      try {
        const stats = await this.host.statFile(file);
        let content = await this.host.readFile(file);
        
        let fileStatus: EditResult["status"] = "success";
        let fileDetail = `File stat successful: mtimeMs=${stats.mtimeMs}, size=${stats.size}`;
        let fileConfidence: number | undefined = undefined;
        let fileMatchedText: string | undefined = undefined;

        for (const edit of edits) {
          const count = content.split(edit.oldString).length - 1;
          if (count === 1) {
            content = content.split(edit.oldString).join(edit.newString);
            continue;
          }

          if (count > 1) {
            fileStatus = "error";
            fileDetail = "Multiple occurrences of exact match found";
            break;
          }

          if (edit.fuzzy) {
            const aggressive = edit.fuzzy === "aggressive";
            const match = findFuzzyMatch(content, edit.oldString, aggressive);
            
            if (match) {
              content = content.substring(0, match.startIndex) + edit.newString + content.substring(match.endIndex);
              fileConfidence = fileConfidence === undefined ? match.confidence : Math.min(fileConfidence, match.confidence);
              fileMatchedText = match.matchedText;
              continue;
            } else {
              fileStatus = "fuzzy_match_failed";
              fileDetail = "Fuzzy match confidence below threshold or no match found";
              break;
            }
          }

          fileStatus = "error";
          fileDetail = "Exact match not found";
          break;
        }

        if (fileStatus === "success") {
          const reStats = await this.host.statFile(file);
          if (reStats.mtimeMs !== stats.mtimeMs) {
            fileStatus = "conflict";
            fileDetail = "File modified by another process during edit";
          } else {
            await this.host.writeFile(file, content);
          }
        }

        const res: EditResult = {
          file,
          status: fileStatus,
          detail: fileDetail,
        };
        if (fileConfidence !== undefined) res.confidence = fileConfidence;
        if (fileMatchedText !== undefined) res.matchedText = fileMatchedText;
        return res;
      } catch (error) {
        const err = error as Error;
        return {
          file,
          status: "error",
          detail: err.message
        } as EditResult;
      }
    });

    const results = await Promise.all(filePromises);
    return { results };
  }
}
