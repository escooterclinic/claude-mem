import { describe, it, expect, afterAll, mock } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// bun's mock.module is process-global and sticky, so the real modules are re-registered in afterAll.
import * as realRuntimeSelector from '../../src/services/hooks/runtime-selector.js';
import * as realWorkerUtils from '../../src/shared/worker-utils.js';
const realRuntimeSnapshot = { ...realRuntimeSelector };
const realWorkerSnapshot = { ...realWorkerUtils };

/**
 * In `server` runtime the PreToolUse:Read file-context hook must never reach the local worker.
 *
 * MEASURED 2026-10-06 (13.29.0): one Read of a >=1500-byte file lazy-spawned a local worker
 * daemon and created claude-mem.db, on a client configured for the shared store. Every Read
 * across every open session did it again, so the client watchdog reported a local-worker
 * FAULT on every tick. The server has no by-file lookup, so this hook has nothing to serve.
 */
let runtime = 'server';
let workerCalls = 0;

mock.module('../../src/services/hooks/runtime-selector.js', () => ({
  ...realRuntimeSnapshot,
  selectRuntime: () => runtime,
}));
mock.module('../../src/shared/worker-utils.js', () => ({
  ...realWorkerSnapshot,
  executeWithWorkerFallback: async () => { workerCalls++; return { observations: [] }; },
}));

const { fileContextHandler } = await import('../../src/cli/handlers/file-context.js');

afterAll(() => {
  mock.module('../../src/services/hooks/runtime-selector.js', () => realRuntimeSnapshot);
  mock.module('../../src/shared/worker-utils.js', () => realWorkerSnapshot);
});

function bigFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'fc-server-'));
  const file = join(dir, 'big.ts');
  writeFileSync(file, 'x'.repeat(4000));
  return file;
}

describe('file-context in server runtime', () => {
  it('never calls the local worker, so it can never lazy-spawn one', async () => {
    runtime = 'server';
    workerCalls = 0;
    const file = bigFile();
    const result = await fileContextHandler.execute({
      sessionId: 's1', cwd: tmpdir(), platform: 'claude-code', toolName: 'Read',
      toolInput: { file_path: file },
    } as any);
    expect(workerCalls).toBe(0);
    expect(result.continue).toBe(true);
  });

  it('still asks the worker in worker runtime (the guard is not a blanket skip)', async () => {
    runtime = 'worker';
    workerCalls = 0;
    const file = bigFile();
    await fileContextHandler.execute({
      sessionId: 's2', cwd: tmpdir(), platform: 'claude-code', toolName: 'Read',
      toolInput: { file_path: file },
    } as any);
    expect(workerCalls).toBeGreaterThan(0);
  });
});
