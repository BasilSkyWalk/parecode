import { ToolHost } from "../adapters/base.js";
import { findFuzzyMatch } from "./fuzzy.js";

export type EditOp =
  | { file: string; replaceLines: [number, number]; content: string; expect: string }
  | { file: string; insertAfter: number; content: string; expect: string }
  | { file: string; oldString: string; newString: string; fuzzy?: boolean | string };

export type EditRequest = {
  edits: EditOp[];
};

export type EditResult = {
  file: string;
  status: "success" | "error" | "conflict" | "fuzzy_match_failed" | "snippet_mismatch";
  detail?: string;
  opResults?: Array<{
    status: EditResult["status"];
    detail?: string;
    confidence?: number;
    matchedText?: string;
  }>;
};

export class EditEngine {
  constructor(private host: ToolHost) {}

  public async edit(request: EditRequest): Promise<{ results: EditResult[] }> {
    const editsByFile = new Map<string, EditOp[]>();
    for (const edit of request.edits) {
      const list = editsByFile.get(edit.file) || [];
      list.push(edit);
      editsByFile.set(edit.file, list);
    }

    const filePromises = Array.from(editsByFile.entries()).map(async ([file, edits]) => {
      try {
        const stats = await this.host.statFile(file);
        const originalContent = await this.host.readFile(file);
        const hasTrailingNewline = originalContent.endsWith("\n");
        let contentLines = originalContent.split(/\r?\n/);
        if (hasTrailingNewline && contentLines[contentLines.length - 1] === "") {
          contentLines.pop();
        }

        const opResults: Array<{
          status: EditResult["status"];
          detail?: string;
          confidence?: number;
          matchedText?: string;
          resolvedRange?: [number, number];
          newLines?: string[];
        }> = [];

        let fileStatus: EditResult["status"] = "success";

        for (const op of edits) {
          let res: (typeof opResults)[0];
          if ("replaceLines" in op) {
            res = this.verifyAndResolveLineOp(contentLines, op.replaceLines[0], op.replaceLines[1], op.expect, op.content);
          } else if ("insertAfter" in op) {
            res = this.verifyAndResolveInsertOp(contentLines, op.insertAfter, op.expect, op.content);
          } else {
            res = this.verifyAndResolveStringOp(originalContent, op.oldString, op.newString, op.fuzzy);
          }
          opResults.push(res);
          if (res.status !== "success" && fileStatus === "success") {
            fileStatus = res.status;
          }
        }

        let fileDetail = "";
        if (fileStatus === "success" && hasOverlappingEdits(opResults)) {
          fileStatus = "error";
          fileDetail = "Overlapping edits target the same lines in one file";
        }

        if (fileStatus === "success") {
          const sortedOps = opResults
            .map((res, i) => ({ res, i }))
            .sort((a, b) => b.res.resolvedRange![0] - a.res.resolvedRange![0]);

          for (const { res } of sortedOps) {
            const [start, end] = res.resolvedRange!;
            contentLines.splice(start - 1, end - start + 1, ...res.newLines!);
          }

          const reStats = await this.host.statFile(file);
          if (reStats.mtimeMs !== stats.mtimeMs) {
            fileStatus = "conflict";
            fileDetail = "File modified by another process during edit";
          } else {
            const newContent = contentLines.join("\n") + (hasTrailingNewline ? "\n" : "");
            await this.host.writeFile(file, newContent);
            fileDetail = `${edits.length} edits applied`;
          }
        }

        return {
          file,
          status: fileStatus,
          detail: fileDetail || (fileStatus !== "success" ? "One or more edits failed" : ""),
          opResults: opResults.map(r => ({
            status: r.status,
            detail: r.detail,
            confidence: r.confidence,
            matchedText: r.matchedText
          }))
        };
      } catch (error) {
        return {
          file,
          status: "error",
          detail: (error as Error).message
        } as EditResult;
      }
    });

    const results = await Promise.all(filePromises);

    let estimatedNativeTokens = 0;
    let actualTokens = 0;
    for (const [file, edits] of editsByFile.entries()) {
      try {
        const stats = await this.host.statFile(file);
        estimatedNativeTokens += Math.ceil(stats.size / 4);
      } catch {}
      for (const op of edits) {
        if ("content" in op) {
          actualTokens += Math.ceil(op.content.length / 4);
        } else if ("oldString" in op) {
          actualTokens += Math.ceil((op.oldString.length + op.newString.length) / 4);
        }
      }
    }
    this.host.recordStat({
      toolCall: "ParecodeEdit",
      filesEdited: editsByFile.size,
      editsApplied: request.edits.length,
      estimatedNativeTokens,
      actualTokens,
      callsBatched: request.edits.length > 0 ? request.edits.length - 1 : 0,
    });

    return { results };
  }

  private verifyAndResolveLineOp(lines: string[], start: number, end: number, expect: string, content: string) {
    const targetLines = lines.slice(start - 1, end);
    const [expectFirst, expectLast] = expect.split("\n…\n");

    const firstMatch = targetLines[0]?.trim() === expectFirst.trim();
    const lastMatch = expectLast ? targetLines[targetLines.length - 1]?.trim() === expectLast.trim() : true;

    if (firstMatch && lastMatch) {
      return {
        status: "success" as const,
        resolvedRange: [start, end] as [number, number],
        newLines: content.split(/\r?\n/)
      };
    }

    const windowStart = Math.max(0, start - 20);
    const windowEnd = Math.min(lines.length, end + 20);
    const windowContent = lines.slice(windowStart, windowEnd).join("\n");
    const match = findFuzzyMatch(windowContent, expect.replace("\n…\n", "\n"), false);
    if (match && match.confidence >= 0.85) {
      const matchStartOffset = windowContent.substring(0, match.startIndex).split("\n").length - 1;
      const matchEndOffset = windowContent.substring(0, match.endIndex).split("\n").length - 1;
      return {
        status: "success" as const,
        confidence: match.confidence,
        matchedText: match.matchedText,
        resolvedRange: [windowStart + matchStartOffset + 1, windowStart + matchEndOffset + 1] as [number, number],
        newLines: content.split(/\r?\n/)
      };
    }

    return { status: "snippet_mismatch" as const, detail: `Expected anchor not found at lines ${start}-${end}` };
  }

  private verifyAndResolveInsertOp(lines: string[], insertAfter: number, expect: string, content: string) {
    if (insertAfter === 0) {
      return {
        status: "success" as const,
        resolvedRange: [1, 0] as [number, number],
        newLines: content.split(/\r?\n/)
      };
    }

    const anchorLine = lines[insertAfter - 1];
    if (anchorLine?.trim() === expect.trim()) {
      return {
        status: "success" as const,
        resolvedRange: [insertAfter + 1, insertAfter] as [number, number],
        newLines: content.split(/\r?\n/)
      };
    }

    const windowStart = Math.max(0, insertAfter - 20);
    const windowEnd = Math.min(lines.length, insertAfter + 20);
    const windowContent = lines.slice(windowStart, windowEnd).join("\n");
    const match = findFuzzyMatch(windowContent, expect, false);
    if (match && match.confidence >= 0.85) {
      const matchEndOffset = windowContent.substring(0, match.endIndex).split("\n").length - 1;
      const resolvedInsertAfter = windowStart + matchEndOffset + 1;
      return {
        status: "success" as const,
        confidence: match.confidence,
        matchedText: match.matchedText,
        resolvedRange: [resolvedInsertAfter + 1, resolvedInsertAfter] as [number, number],
        newLines: content.split(/\r?\n/)
      };
    }

    return { status: "snippet_mismatch" as const, detail: `Expected anchor line not found near line ${insertAfter}` };
  }

  private verifyAndResolveStringOp(content: string, oldString: string, newString: string, fuzzy?: boolean | string) {
    const count = content.split(oldString).length - 1;
    let match: { startIndex: number; endIndex: number; matchedText: string; confidence: number } | null = null;

    if (count === 1) {
      const startIndex = content.indexOf(oldString);
      match = { startIndex, endIndex: startIndex + oldString.length, matchedText: oldString, confidence: 1.0 };
    } else if (count > 1) {
      return { status: "error" as const, detail: "Multiple occurrences of exact match found" };
    } else if (fuzzy) {
      const fuzzyMatch = findFuzzyMatch(content, oldString, fuzzy === "aggressive");
      if (fuzzyMatch) {
        match = fuzzyMatch;
      } else {
        return { status: "fuzzy_match_failed" as const, detail: "Fuzzy match failed" };
      }
    }

    if (!match) return { status: "error" as const, detail: "Exact match not found" };

    const prefix = content.substring(0, match.startIndex);
    const suffix = content.substring(match.endIndex);
    const startLine = prefix.split("\n").length;
    const endLine = content.substring(0, match.endIndex).split("\n").length;

    const lineStartOffset = prefix.lastIndexOf("\n") + 1;
    const nextNewline = suffix.indexOf("\n");
    const lineEndOffset = nextNewline === -1 ? suffix.length : nextNewline;
    const fullNewText = prefix.substring(lineStartOffset) + newString + suffix.substring(0, lineEndOffset);

    return {
      status: "success" as const,
      confidence: match.confidence,
      matchedText: match.matchedText,
      resolvedRange: [startLine, endLine] as [number, number],
      newLines: fullNewText.split(/\r?\n/)
    };
  }
}

function hasOverlappingEdits(opResults: Array<{ resolvedRange?: [number, number] }>): boolean {
  const replaced = opResults
    .map((r) => r.resolvedRange!)
    .filter(([start, end]) => end >= start)
    .sort((a, b) => a[0] - b[0]);

  for (let i = 1; i < replaced.length; i++) {
    if (replaced[i][0] <= replaced[i - 1][1]) return true;
  }

  for (const r of opResults) {
    const [start, end] = r.resolvedRange!;
    if (end >= start) continue;
    const insertAfter = start - 1;
    for (const [rStart, rEnd] of replaced) {
      if (insertAfter >= rStart && insertAfter < rEnd) return true;
    }
  }

  return false;
}
