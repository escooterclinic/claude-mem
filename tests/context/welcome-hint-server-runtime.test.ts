import { afterAll, afterEach, describe, expect, it, mock } from 'bun:test';

import * as realRuntimeSelector from '../../src/services/hooks/runtime-selector.js';

/**
 * The onboarding hint ("This project has no memory yet") is decided by a COUNT(*)
 * against the local SQLite file, BEFORE the context builder runs at all.
 *
 * In server runtime that file is a mirror, and a machine whose mirror was never
 * populated for a project renders the hint while the shared store holds the whole
 * history. MEASURED 2026-09-23 on the second workstation: it showed the onboarding
 * hint against a store holding 319,679 rows for that same project, and no amount of
 * fixing the context builder could be seen, because this gate returned first.
 *
 * Removing the `isServerRuntime()` short-circuit must fail this test.
 */

const realSnapshot = { ...realRuntimeSelector };
let runtimeStub: unknown = { runtime: 'worker' };

mock.module('../../src/services/hooks/runtime-selector.js', () => ({
  resolveRuntimeContext: () => runtimeStub,
}));

const { SearchRoutes } = await import('../../src/services/worker/http/routes/SearchRoutes.js');

afterEach(() => { runtimeStub = { runtime: 'worker' }; });
afterAll(() => { mock.module('../../src/services/hooks/runtime-selector.js', () => realSnapshot); });

// A store that REFUSES to be counted. In server runtime nothing may reach it; if
// anything does, this throws and the test says so rather than passing quietly.
const forbiddenStore = new Proxy({}, {
  get() { throw new Error('the local corpus was consulted in server runtime'); },
}) as never;

const routes = () => new (SearchRoutes as never as new (m: unknown, s: unknown) => {
  projectsHaveObservations(store: unknown, projects: string[], platformSource?: string): Promise<boolean>;
})({ getSessionStore: () => forbiddenStore }, null);

describe('the onboarding hint never speaks for the shared store', () => {
  it('reports the project as non-empty in server runtime WITHOUT touching the local corpus', async () => {
    runtimeStub = { runtime: 'server', projectId: 'patrykradek', client: {} };
    const r = routes();
    expect(await r.projectsHaveObservations(forbiddenStore, ['patrykradek'], undefined)).toBe(true);
  });

  it('still counts the local corpus in worker runtime, where it IS the truth', async () => {
    runtimeStub = { runtime: 'worker' };
    const r = routes();
    // Reaching the store is CORRECT here, so the forbidden proxy throwing proves
    // the short-circuit did not fire in the runtime that must not have it.
    await expect(r.projectsHaveObservations(forbiddenStore, ['p'], undefined)).rejects.toThrow(
      'the local corpus was consulted in server runtime'
    );
  });
});
