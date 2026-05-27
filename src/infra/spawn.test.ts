import { describe, it, expect } from "vitest";
import { spawnCommand, resolveCommand } from "./spawn.js";

describe("spawn infra", () => {
  it("resolves basic commands", async () => {
    const nodePath = await resolveCommand("node");
    expect(nodePath).toBeTruthy();
    expect(typeof nodePath).toBe("string");
  });

  it("handles commands with arguments containing spaces without shell interpolation", async () => {
    const nodePath = await resolveCommand("node");
    expect(nodePath).toBeTruthy();

    const script = `console.log(process.argv[1]);`;
    const spaceArg = "path with spaces/and quotes'";

    const result = await spawnCommand(nodePath!, ["-e", script, spaceArg]);
    
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe(spaceArg);
  });
});
