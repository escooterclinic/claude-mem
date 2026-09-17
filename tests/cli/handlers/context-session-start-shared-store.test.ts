import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test';

import * as realHookSettings from '../../../src/shared/hook-settings.js';
import * as realOauthToken from '../../../src/shared/oauth-token.js';
import * as realProjectName from '../../../src/utils/project-name.js';
import * as realWorkerUtils from '../../../src/shared/worker-utils.js';
import * as realRuntimeSelector from '../../../src/services/hooks/runtime-selector.js';

/**
 * In `server` runtime session-start must read the SHARED store, not the per-machine
 * SQLite corpus the worker renders.
 *
 * MEASURED 2026-09-17 on this estate: the local corpus took 1 observation in 24h
 * while the shared store took 18,184. Nothing errored -- the client has shipped
 * `contextObservations()` -> POST /v1/context all along and NOTHING called it, so a
 * session simply opened onto a corpus frozen where server mode began. A detector
 * cannot see that; only a test that pins WHICH store was asked can.
 *
 * Every case below asserts BEHAVIOUR -- which stub was invoked and with what -- and
 * both directions are covered, because "reads the server" and "still falls back when
 * the server cannot answer" fail independently and the second is how a bad deploy
 * costs a user their memory entirely.
 */

const realHookSettingsSnapshot = { ...realHookSettings };
const realOauthTokenSnapshot = { ...realOauthToken };
const realProjectNameSnapshot = { ...realProjectName };
const realWorkerUtilsSnapshot = { ...realWorkerUtils };
const realRuntimeSelectorSnapshot = { ...realRuntimeSelector };

let workerCalls: unknown[][] = [];
let contextCalls: Array<Record<string, unknown>> = [];
let settingsStub: Record<string, string> = {};
let runtimeStub: unknown = { runtime: 'worker' };
let contextImpl: (input: Record<string, unknown>) => Promise<unknown> =
  async () => ({ context: 'context from the SHARED store', observations: [{ id: 'a' }] });

mock.module('../../../src/shared/hook-settings.js', () => ({
  loadFromFileOnce: () => settingsStub,
}));
mock.module('../../../src/shared/oauth-token.js', () => ({ readStaleMarker: () => null }));
mock.module('../../../src/utils/project-name.js', () => ({
  getProjectContext: () => ({
    primary: 'repo-project',
    parent: 'repo-project',
    isWorktree: false,
    allProjects: ['repo-project'],
  }),
}));
mock.module('../../../src/shared/worker-utils.js', () => ({
  executeWithWorkerFallback: async (...args: unknown[]) => {
    workerCalls.push(args);
    return 'context from the LOCAL corpus';
  },
  getWorkerPort: () => 37777,
  isWorkerFallback: () => false,
}));
mock.module('../../../src/services/hooks/runtime-selector.js', () => ({
  resolveRuntimeContext: () => runtimeStub,
}));

const serverRuntime = () => ({
  runtime: 'server',
  projectId: 'patrykradek',
  serverBaseUrl: 'http://192.168.108.122:37878',
  client: {
    contextObservations: async (input: Record<string, unknown>) => {
      contextCalls.push(input);
      return contextImpl(input);
    },
  },
});

const { contextHandler } = await import('../../../src/cli/handlers/context.js');
const run = () => contextHandler.execute({ cwd: '/tmp/repo-project', platform: 'claude-code' } as never);
const injected = (r: { hookSpecificOutput?: { additionalContext?: string } }) =>
  r.hookSpecificOutput?.additionalContext ?? '';

beforeEach(() => {
  workerCalls = [];
  contextCalls = [];
  settingsStub = { CLAUDE_MEM_CONTEXT_SHOW_TERMINAL_OUTPUT: 'false' };
  runtimeStub = { runtime: 'worker' };
  contextImpl = async () => ({ context: 'context from the SHARED store', observations: [{ id: 'a' }] });
});

afterAll(() => {
  mock.module('../../../src/shared/hook-settings.js', () => realHookSettingsSnapshot);
  mock.module('../../../src/shared/oauth-token.js', () => realOauthTokenSnapshot);
  mock.module('../../../src/utils/project-name.js', () => realProjectNameSnapshot);
  mock.module('../../../src/shared/worker-utils.js', () => realWorkerUtilsSnapshot);
  mock.module('../../../src/services/hooks/runtime-selector.js', () => realRuntimeSelectorSnapshot);
});

describe('session-start context in server runtime', () => {
  it('reads the SHARED store and never asks the worker', async () => {
    runtimeStub = serverRuntime();
    const result = await run();
    expect(injected(result)).toBe('context from the SHARED store');
    expect(contextCalls).toHaveLength(1);
    expect(workerCalls).toHaveLength(0);
  });

  it('omits `query` ENTIRELY, because the key is what selects recency over relevance', async () => {
    runtimeStub = serverRuntime();
    await run();
    // Not `query: ''` and not `query: undefined` spelled out -- ABSENT. The route
    // rejects an empty string (min 1 char) and answers by FTS when a query is
    // present, so either mistake turns session-start into a search for nothing.
    expect(Object.prototype.hasOwnProperty.call(contextCalls[0], 'query')).toBe(false);
    expect(contextCalls[0].projectId).toBe('patrykradek');
  });

  it('clamps the limit to what the route accepts', async () => {
    runtimeStub = serverRuntime();
    settingsStub = { CLAUDE_MEM_CONTEXT_SHOW_TERMINAL_OUTPUT: 'false', CLAUDE_MEM_CONTEXT_OBSERVATIONS: '500' };
    await run();
    // The route REFUSES above 50 with a ValidationError. Unclamped this does not
    // degrade, it fails, and the session opens with no memory at all.
    expect(contextCalls[0].limit).toBe(50);
  });

  it('passes a configured limit through when it is already in range', async () => {
    runtimeStub = serverRuntime();
    settingsStub = { CLAUDE_MEM_CONTEXT_SHOW_TERMINAL_OUTPUT: 'false', CLAUDE_MEM_CONTEXT_OBSERVATIONS: '12' };
    await run();
    expect(contextCalls[0].limit).toBe(12);
  });
});

describe('session-start falls back rather than losing the memory block', () => {
  it('uses the local corpus when the store throws', async () => {
    runtimeStub = serverRuntime();
    contextImpl = async () => { throw new Error('ECONNREFUSED'); };
    const result = await run();
    expect(injected(result)).toBe('context from the LOCAL corpus');
    expect(workerCalls).toHaveLength(1);
  });

  it('uses the local corpus when the store answers without a context string', async () => {
    runtimeStub = serverRuntime();
    // The client casts the JSON without validating it, so an empty 200 arrives
    // as `{}`. Injecting that would show an EMPTY memory, which reads as "there
    // is nothing to remember" rather than "the store did not answer".
    contextImpl = async () => ({});
    const result = await run();
    expect(injected(result)).toBe('context from the LOCAL corpus');
    expect(workerCalls).toHaveLength(1);
  });

  it('never consults the store in worker runtime', async () => {
    runtimeStub = { runtime: 'worker' };
    const result = await run();
    expect(injected(result)).toBe('context from the LOCAL corpus');
    expect(contextCalls).toHaveLength(0);
    expect(workerCalls).toHaveLength(1);
  });
});
