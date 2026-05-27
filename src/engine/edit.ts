import { ToolHost } from "../adapters/base.js";

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
        
        results.push({
          file: edit.file,
          status: "success",
          detail: `File stat successful: mtimeMs=${stats.mtimeMs}, size=${stats.size}`
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
