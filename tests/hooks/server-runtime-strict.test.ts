import { describe, expect, it } from 'bun:test';
import { mkdtempSync, existsSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = process.cwd();
function isolated(script: string, runtime = 'server') {
  const home = mkdtempSync(join(tmpdir(), 'cm-strict-server-'));
  try {
    const result = Bun.spawnSync([process.execPath, '-e', script], {
      cwd: root,
      env: { ...process.env, HOME: home, CLAUDE_MEM_DATA_DIR: join(home, '.claude-mem'),
        CLAUDE_MEM_RUNTIME: runtime, CLAUDE_MEM_INTERNAL: '', CLAUDE_MEM_EXCLUDED_PROJECTS: '' },
      stdout: 'pipe', stderr: 'pipe',
    });
    expect(result.exitCode).toBe(0);
    expect(existsSync(join(home, '.claude-mem', 'claude-mem.db'))).toBe(false);
    const logs = join(home, '.claude-mem', 'logs');
    const log = existsSync(logs) ? readdirSync(logs).filter(name => name.endsWith('.log'))
      .map(name => readFileSync(join(logs, name), 'utf8')).join('\n') : '';
    return { out: result.stdout.toString(), err: result.stderr.toString(), log };
  } finally { rmSync(home, { recursive: true, force: true }); }
}

const workerTripwire = `
import { mock } from 'bun:test';
const worker = await import('./src/shared/worker-utils.ts');
mock.module('./src/shared/worker-utils.ts', () => ({ ...worker,
  executeWithWorkerFallback: async () => { throw new Error('LOCAL_WORKER_CALLED'); },
}));
mock.module('./src/cli/spool-hook-event.ts', () => ({
  spoolHookEvent: () => { throw new Error('LOCAL_WORKER_CALLED'); },
}));
`;
const input = `{ sessionId: 'strict-test-session', cwd: '/tmp/strict-project', platform: 'claude-code',
  prompt: 'test prompt', toolName: 'Read', toolInput: {}, toolResponse: 'result',
  lastAssistantMessage: 'finished test work' }`;

describe('org strict server runtime', () => {
  for (const runtime of ['server', 'server-beta']) {
    it(`${runtime} generated worker bundle start never spawns`, () => {
      const result = isolated(`
import { mock } from 'bun:test';
const cp = await import('node:child_process');
mock.module('child_process', () => ({ ...cp, spawn: () => { throw new Error('BUNDLE_SPAWN_CALLED'); } }));
process.argv = [process.execPath, 'worker-service.cjs', 'start'];
process.env.CLAUDE_MEM_MANAGED = 'true';
await import('./plugin/scripts/worker-service.cjs');
`, runtime);
      expect(result.err).not.toContain('BUNDLE_SPAWN_CALLED');
      expect(result.log).not.toContain('BUNDLE_SPAWN_CALLED');
      expect(result.err).toContain('server runtime: local worker not started');
      expect(JSON.parse(result.out)).toMatchObject({ continue: true, status: 'ready' });
    });
    it(`${runtime} start never calls ensureWorkerStarted or spawn`, () => {
      const result = isolated(`
import { mock } from 'bun:test';
const spawner = await import('./src/services/worker-spawner.ts');
mock.module('./src/services/worker-spawner.ts', () => ({ ...spawner,
  ensureWorkerStarted: async () => { throw new Error('ENSURE_WORKER_CALLED'); },
}));
const cp = await import('node:child_process');
mock.module('child_process', () => ({ ...cp, spawn: () => { throw new Error('SPAWN_CALLED'); } }));
process.argv = [process.execPath, 'worker-service.cjs', 'start'];
process.env.CLAUDE_MEM_MANAGED = 'true';
await import('./src/services/worker-service.ts');
`, runtime);
      expect(result.err).not.toContain('ENSURE_WORKER_CALLED');
      expect(result.err).not.toContain('SPAWN_CALLED');
      expect(result.err).toContain('server runtime: local worker not started');
      expect(result.log).toContain('server runtime: local worker not started');
    });
  }
  for (const [module, handler] of [
    ['observation', 'observationHandler'], ['session-init', 'sessionInitHandler'],
    ['summarize', 'summarizeHandler'], ['session-end', 'sessionEndHandler'],
  ]) {
    it(`${module}: missing settings never dispatch locally or create SQLite`, () => {
      const result = isolated(workerTripwire + `
mock.module('./src/shared/hook-settings.ts', () => ({ loadFromFileOnce: () => ({
 CLAUDE_MEM_RUNTIME: 'server', CLAUDE_MEM_SERVER_URL: '', CLAUDE_MEM_SERVER_API_KEY: '', CLAUDE_MEM_SERVER_PROJECT_ID: '',
}) }));
const { ${handler} } = await import('./src/cli/handlers/${module}.ts');
const result = await ${handler}.execute(${input});
if (result.exitCode !== 0) throw new Error('hook must exit 0');
`);
      expect(result.err).toContain('server-misconfigured');
      expect(result.log).toContain('server-misconfigured');
      for (const key of ['URL', 'API_KEY', 'PROJECT_ID']) expect(result.err).toContain(`CLAUDE_MEM_SERVER_${key}`);
      expect(result.err).not.toContain('LOCAL_WORKER_CALLED');
    });
  }
  for (const [module, handler] of [
    ['observation', 'observationHandler'], ['session-init', 'sessionInitHandler'], ['summarize', 'summarizeHandler'],
  ]) {
    for (const failure of ['503', '429', '401', 'transport']) {
      it(`${module}: ${failure} stays server-only`, () => {
        const result = isolated(workerTripwire + `
mock.module('./src/shared/hook-settings.ts', () => ({ loadFromFileOnce: () => ({
 CLAUDE_MEM_RUNTIME: 'server', CLAUDE_MEM_SERVER_URL: 'http://server.test', CLAUDE_MEM_SERVER_API_KEY: 'test-key', CLAUDE_MEM_SERVER_PROJECT_ID: 'test-project',
}) }));
globalThis.fetch = async () => ${failure === 'transport' ? "{ throw new TypeError('connection failed'); }" : `new Response('{}', { status: ${failure} })`};
const { ${handler} } = await import('./src/cli/handlers/${module}.ts');
const result = await ${handler}.execute(${input});
if (result.exitCode !== 0) throw new Error('hook must exit 0');
`);
        expect(result.err).toContain('server request failed');
        expect(result.log).toContain('server request failed');
        expect(result.err).toContain(failure === 'transport' ? 'error=transport' : `status=${failure}`);
        expect(result.err).not.toContain('LOCAL_WORKER_CALLED');
      });
    }
  }
  for (const runtime of ['', 'worker']) {
    it(`${runtime || 'unset'} runtime retains worker dispatch`, () => {
      const result = isolated(`
import { mock } from 'bun:test';
mock.module('./src/cli/spool-hook-event.ts', () => ({
 spoolHookEvent: (kind, payload) => {
   if (kind !== 'observation' || payload.contentSessionId !== 'strict-test-session' || payload.toolName !== 'Read') {
     throw new Error('invalid worker dispatch: ' + JSON.stringify({ kind, payload }));
   }
   console.log('WORKER_DISPATCH');
 },
}));
const { observationHandler } = await import('./src/cli/handlers/observation.ts');
await observationHandler.execute(${input});
`, runtime);
      expect(result.out).toContain('WORKER_DISPATCH');
    });
  }
});
