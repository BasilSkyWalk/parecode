import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";
import { dir } from "tmp-promise";

describe("MCP Integration E2E", () => {
  let client: Client;
  let transport: StdioClientTransport;
  let tmpDirPath: string;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    const tmp = await dir({ unsafeCleanup: true });
    tmpDirPath = tmp.path;
    cleanup = tmp.cleanup;

    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const cliPath = path.resolve(__dirname, "index.ts");

    transport = new StdioClientTransport({
      command: "npx",
      args: ["tsx", cliPath, "serve"],
      env: process.env as Record<string, string>
    });

    client = new Client({
      name: "test-client",
      version: "1.0.0"
    }, {
      capabilities: {}
    });

    await client.connect(transport);
  });

  afterAll(async () => {
    if (transport) {
      await transport.close();
    }
    if (cleanup) {
      await cleanup();
    }
  });

  it("should list tools", async () => {
    const tools = await client.listTools();
    const toolNames = tools.tools.map((t) => t.name).sort();
    expect(toolNames).toEqual(["ParecodeEdit", "ParecodeSearch"]);
  });

  it("should execute ParecodeSearch", async () => {
    const testFile = path.join(tmpDirPath, "search_test.txt");
    await fs.writeFile(testFile, "hello world\nhello parecode", "utf-8");

    const result = await client.callTool({
      name: "ParecodeSearch",
      arguments: {
        pattern: "parecode",
        paths: [tmpDirPath]
      }
    });

    const res = result as any;
    expect(res.content[0].type).toBe("text");
    const json = JSON.parse(res.content[0].text as string);
    expect(json.status).toBe("success");
    expect(json.matches[0].file).toBe(testFile);
  });

  it("should execute ParecodeEdit", async () => {
    const testFile = path.join(tmpDirPath, "edit_test.txt");
    await fs.writeFile(testFile, "let a = 1;", "utf-8");

    const result = await client.callTool({
      name: "ParecodeEdit",
      arguments: {
        edits: [{
          file: testFile,
          oldString: "let a = 1;",
          newString: "let a = 2;"
        }]
      }
    });

    const res = result as any;
    expect(res.content[0].type).toBe("text");
    const json = JSON.parse(res.content[0].text as string);
    expect(json.results[0].status).toBe("success");

    const newContent = await fs.readFile(testFile, "utf-8");
    expect(newContent).toBe("let a = 2;");
  });
});
