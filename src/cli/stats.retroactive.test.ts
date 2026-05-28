import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { statsCommand } from './stats.js';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('statsCommand --retroactive integration', () => {
  let stdoutWriteSpy: any;
  let exitSpy: any;

  beforeEach(() => {
    stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('process.exit called'); }) as any);
    
    process.env.CLAUDE_CONFIG_DIR = path.join(__dirname, '__fixtures__');
    process.env.PARECODE_DATA_DIR = path.join(__dirname, '__fixtures__');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.CLAUDE_CONFIG_DIR;
    delete process.env.PARECODE_DATA_DIR;
  });

  it('prints retroactive stats correctly using real fixtures', async () => {
    await statsCommand(['--retroactive', '--since', '10000d']);
    expect(stdoutWriteSpy.mock.calls.map((c: any) => c[0]).join('')).toMatchSnapshot();
  });
});
