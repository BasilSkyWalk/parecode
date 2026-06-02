import * as path from "node:path";

export interface ReturnedWindow {
  file: string;
  startLine: number;
  endLine: number;
  returnedAt: number;
  fromCallId: string;
}

export interface Spill {
  path: string;
  createdAt: number;
  consumed: boolean;
  fromCallId: string;
  patterns?: string[];
  paths?: string[];
}

export interface PatternWarning {
  pattern: string;
  reason: string;
  raisedAt: number;
}

export interface SessionMemory {
  sessionId: string;
  startedAt: number;
  returnedWindows: ReturnedWindow[];
  spills: Spill[];
  patternWarnings: PatternWarning[];
}

export interface SessionMemoryIo {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
}

export const MAX_RETURNED_WINDOWS = 1024;
export const MAX_SPILLS = 64;

export function createSessionMemory(sessionId: string, startedAt: number = Date.now()): SessionMemory {
  return { sessionId, startedAt, returnedWindows: [], spills: [], patternWarnings: [] };
}

export function recordReturnedWindows(memory: SessionMemory, windows: ReturnedWindow[]): SessionMemory {
  return {
    ...memory,
    returnedWindows: keepNewest([...memory.returnedWindows, ...windows], MAX_RETURNED_WINDOWS),
  };
}

export function recordSpill(memory: SessionMemory, spill: Spill): SessionMemory {
  return {
    ...memory,
    spills: keepNewest([...memory.spills, spill], MAX_SPILLS),
  };
}

export function markSpillConsumed(memory: SessionMemory, path: string): SessionMemory {
  const spills = memory.spills.map((s) => (s.path === path && !s.consumed ? { ...s, consumed: true } : s));
  return { ...memory, spills };
}

export function recordPatternWarning(memory: SessionMemory, warning: PatternWarning): SessionMemory {
  return {
    ...memory,
    patternWarnings: [...memory.patternWarnings, warning],
  };
}

export function sessionFilePath(dir: string, sessionId: string): string {
  return path.join(dir, `${sessionId}.json`);
}

export async function load(io: SessionMemoryIo, dir: string, sessionId: string): Promise<SessionMemory> {
  let raw: string;
  try {
    raw = await io.readFile(sessionFilePath(dir, sessionId));
  } catch {
    return createSessionMemory(sessionId);
  }
  return parseSessionMemory(raw) ?? createSessionMemory(sessionId);
}

export async function persist(io: SessionMemoryIo, dir: string, memory: SessionMemory): Promise<void> {
  await io.writeFile(sessionFilePath(dir, memory.sessionId), JSON.stringify(memory));
}

export interface DebouncedPersister {
  persist(memory: SessionMemory): void;
  flush(): Promise<void>;
}

export function createDebouncedPersister(io: SessionMemoryIo, dir: string, delayMs = 100): DebouncedPersister {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let latestMemory: SessionMemory | undefined;
  let writePromise: Promise<void> | undefined;

  async function flush(): Promise<void> {
    if (timeout !== undefined) {
      clearTimeout(timeout);
      timeout = undefined;
    }
    if (!latestMemory) {
      return;
    }
    const memory = latestMemory;
    latestMemory = undefined;

    if (writePromise) {
      await writePromise.catch(() => {});
    }
    writePromise = persist(io, dir, memory);
    await writePromise;
  }

  return {
    persist(memory: SessionMemory) {
      latestMemory = memory;
      if (timeout === undefined) {
        timeout = setTimeout(() => {
          timeout = undefined;
          flush().catch(() => {});
        }, delayMs);
      }
    },
    flush,
  };
}

function keepNewest<T>(items: T[], max: number): T[] {
  return items.length <= max ? items : items.slice(items.length - max);
}

function parseSessionMemory(raw: string): SessionMemory | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  return isSessionMemory(data) ? data : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isReturnedWindow(value: unknown): value is ReturnedWindow {
  if (!isRecord(value)) return false;
  return (
    typeof value.file === "string" &&
    typeof value.startLine === "number" &&
    typeof value.endLine === "number" &&
    typeof value.returnedAt === "number" &&
    typeof value.fromCallId === "string"
  );
}

function isSpill(value: unknown): value is Spill {
  if (!isRecord(value)) return false;
  return (
    typeof value.path === "string" &&
    typeof value.createdAt === "number" &&
    typeof value.consumed === "boolean" &&
    typeof value.fromCallId === "string" &&
    (value.patterns === undefined || (Array.isArray(value.patterns) && value.patterns.every(p => typeof p === "string"))) &&
    (value.paths === undefined || (Array.isArray(value.paths) && value.paths.every(p => typeof p === "string")))
  );
}

function isPatternWarning(value: unknown): value is PatternWarning {
  if (!isRecord(value)) return false;
  return (
    typeof value.pattern === "string" &&
    typeof value.reason === "string" &&
    typeof value.raisedAt === "number"
  );
}

function isSessionMemory(value: unknown): value is SessionMemory {
  if (!isRecord(value)) return false;
  return (
    typeof value.sessionId === "string" &&
    typeof value.startedAt === "number" &&
    Array.isArray(value.returnedWindows) &&
    value.returnedWindows.every(isReturnedWindow) &&
    Array.isArray(value.spills) &&
    value.spills.every(isSpill) &&
    Array.isArray(value.patternWarnings) &&
    value.patternWarnings.every(isPatternWarning)
  );
}
