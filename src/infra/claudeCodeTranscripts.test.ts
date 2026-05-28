import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { dir } from "tmp-promise";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  resolveTranscriptDir,
  transcriptDirExists,
  listProjectDirs,
  listSessionFiles,
  decodeProjectName,
} from "./claudeCodeTranscripts.js";

describe("claudeCodeTranscripts", () => {
  let tmp: { path: string; cleanup: () => Promise<void> };
  let originalConfigDir: string | undefined;

  beforeEach(async () => {
    tmp = await dir({ unsafeCleanup: true });
    originalConfigDir = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = tmp.path;
  });

  afterEach(async () => {
    if (originalConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = originalConfigDir;
    await tmp.cleanup();
  });

  it("resolveTranscriptDir honors CLAUDE_CONFIG_DIR", () => {
    expect(resolveTranscriptDir()).toBe(path.join(tmp.path, "projects"));
  });

  it("transcriptDirExists returns false when projects/ is missing", async () => {
    expect(await transcriptDirExists()).toBe(false);
  });

  it("transcriptDirExists returns true when projects/ exists as a directory", async () => {
    await fs.mkdir(path.join(tmp.path, "projects"), { recursive: true });
    expect(await transcriptDirExists()).toBe(true);
  });

  it("listProjectDirs returns [] for a missing transcript dir", async () => {
    expect(await listProjectDirs()).toEqual([]);
  });

  it("listProjectDirs returns subdirectories sorted, ignoring files", async () => {
    const projects = path.join(tmp.path, "projects");
    await fs.mkdir(path.join(projects, "-Users-bob-app"), { recursive: true });
    await fs.mkdir(path.join(projects, "-Users-alice-repo"), { recursive: true });
    await fs.writeFile(path.join(projects, "index.json"), "{}", "utf-8");

    const result = await listProjectDirs();
    expect(result).toHaveLength(2);
    expect(path.basename(result[0])).toBe("-Users-alice-repo");
    expect(path.basename(result[1])).toBe("-Users-bob-app");
  });

  it("listSessionFiles returns .jsonl files only, sorted", async () => {
    const project = path.join(tmp.path, "projects", "-Users-x-y");
    await fs.mkdir(project, { recursive: true });
    await fs.writeFile(path.join(project, "b.jsonl"), "", "utf-8");
    await fs.writeFile(path.join(project, "a.jsonl"), "", "utf-8");
    await fs.writeFile(path.join(project, "not-a-session.txt"), "", "utf-8");
    await fs.mkdir(path.join(project, "subdir"));

    const files = await listSessionFiles(project);
    expect(files.map((f) => path.basename(f))).toEqual(["a.jsonl", "b.jsonl"]);
  });

  it("listSessionFiles returns [] for a missing project dir", async () => {
    expect(await listSessionFiles(path.join(tmp.path, "projects", "missing"))).toEqual([]);
  });

  it("decodeProjectName converts encoded absolute path back to a path", () => {
    expect(decodeProjectName("-Users-super-Documents-code-studio-parecode")).toBe(
      path.join(path.sep, "Users", "super", "Documents", "code", "studio", "parecode"),
    );
  });

  it("decodeProjectName accepts a full directory path and decodes the basename", () => {
    const encoded = path.join(tmp.path, "projects", "-Users-alice-repo");
    expect(decodeProjectName(encoded)).toBe(path.join(path.sep, "Users", "alice", "repo"));
  });
});
