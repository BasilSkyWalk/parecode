import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

export interface UpdateIo {
  packageRoot(): Promise<string>;
  readVersion(root: string): Promise<string>;
  exec(cmd: string, args: string[]): Promise<{ stdout: string; code: number | null }>;
  runInherit(cmd: string, args: string[]): Promise<number>;
  stdout(msg: string): void;
  stderr(msg: string): void;
}

async function findPackageRoot(): Promise<string> {
  let current = path.dirname(fileURLToPath(import.meta.url));
  while (true) {
    try {
      const pkg = JSON.parse(await fs.readFile(path.join(current, "package.json"), "utf-8"));
      if (pkg.name === "parecode") return current;
    } catch {}
    const parent = path.dirname(current);
    if (parent === current) throw new Error("Could not locate the parecode package root");
    current = parent;
  }
}

function execCapture(cmd: string, args: string[]): Promise<{ stdout: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "ignore"] });
    let stdout = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ stdout, code }));
  });
}

function runWithInheritedStdio(cmd: string, args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });
}

const defaultIo: UpdateIo = {
  packageRoot: findPackageRoot,
  readVersion: async (root) => JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf-8")).version,
  exec: execCapture,
  runInherit: runWithInheritedStdio,
  stdout: (msg) => process.stdout.write(msg + "\n"),
  stderr: (msg) => process.stderr.write(msg + "\n"),
};

function isWithin(parent: string, child: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

export async function updateCommand(args: string[], io: UpdateIo = defaultIo): Promise<number> {
  let root: string;
  let currentVersion: string;
  try {
    root = await io.packageRoot();
    currentVersion = await io.readVersion(root);
  } catch (err) {
    io.stderr(`Could not inspect the current install: ${err}`);
    return 1;
  }

  const npmRoot = await io.exec("npm", ["root", "-g"]).catch(() => null);
  if (!npmRoot || npmRoot.code !== 0 || !isWithin(npmRoot.stdout.trim(), root)) {
    io.stderr(`parecode at ${root} is not an npm global install, so 'parecode update' cannot manage it.`);
    io.stderr("Update it with your install method, e.g.: npm install -g parecode@latest && parecode init");
    return 1;
  }

  io.stdout(`Updating parecode ${currentVersion} via npm...`);
  const installCode = await io.runInherit("npm", ["install", "-g", "parecode@latest"]);
  if (installCode !== 0) {
    io.stderr(`npm install failed with exit code ${installCode}`);
    return installCode;
  }

  const newVersion = await io.readVersion(root);
  io.stdout(
    newVersion === currentVersion
      ? `parecode already at the latest version (${newVersion})`
      : `parecode ${currentVersion} → ${newVersion}`
  );

  io.stdout("Refreshing hooks and plugin via 'parecode init'...");
  const initCode = await io.runInherit(process.execPath, [path.join(root, "dist/cli/index.js"), "init"]);
  if (initCode !== 0) {
    io.stderr(`init refresh failed with exit code ${initCode}; run 'parecode init' manually.`);
    return initCode;
  }

  io.stdout("Done. Run 'parecode doctor' to verify.");
  return 0;
}
