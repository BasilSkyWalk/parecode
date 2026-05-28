import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { statsCommand } from './stats.js';
import * as path from 'node:path';

describe('statsCommand', () => {
  let stdoutWriteSpy: any;
  let stderrWriteSpy: any;
  let exitSpy: any;

  beforeEach(() => {
    stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrWriteSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('process.exit called'); }) as any);

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-28T00:00:00Z'));
    
    process.env.PARECODE_DATA_DIR = path.join(__dirname, '__fixtures__');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    delete process.env.PARECODE_DATA_DIR;
  });

  it('prints default 7d stats as text', async () => {
    await statsCommand([]);
    expect(stdoutWriteSpy.mock.calls.map((c: any) => c[0]).join('')).toMatchSnapshot();
  });

  it('prints 7d stats as json', async () => {
    await statsCommand(['--json']);
    expect(stdoutWriteSpy.mock.calls.map((c: any) => c[0]).join('')).toMatchSnapshot();
  });

  it('prints 30d stats as text', async () => {
    await statsCommand(['--since', '30d']);
    expect(stdoutWriteSpy.mock.calls.map((c: any) => c[0]).join('')).toMatchSnapshot();
  });

  it('handles invalid since flag gracefully', async () => {
    await expect(statsCommand(['--since', 'invalid'])).rejects.toThrow('process.exit called');
    expect(stderrWriteSpy.mock.calls.map((c: any) => c[0]).join('')).toMatch(/Invalid --since value: invalid/);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
