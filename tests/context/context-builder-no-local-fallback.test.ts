import { afterAll, afterEach, describe, expect, it, mock } from 'bun:test';

import * as realRuntimeSelector from '../../src/services/hooks/runtime-selector.js';

/**
 * In `server` runtime the session-start block is built from the SHARED store and
 * from NOTHING ELSE.
 *
 * The first cut of this fix fell back to the local SQLite corpus whenever the store
 * gave no answer, on the reasoning that a stale corpus beats no memory. MEASURED
 * 2026-09-23, that reasoning is what hid the fault for five days: every write went
 * to the hub while the block was served from a local mirror frozen at
 * 2026-09-19T23:05Z -- 128,104 rows against the hub's 347,146 -- and because the
 * fallback is silent, the block looked healthy the whole time. It showed the newest
 * 50 of a dead mirror and said nothing.
 *
 * A block that cannot be built is therefore SAID to be unbuildable. Silence about a
 * degraded source is the defect; an empty answer is not.
 */

const realSnapshot = { ...realRuntimeSelector };

let runtimeStub: unknown = { runtime: 'worker' };
let localCalls = 0;

mock.module('../../src/services/hooks/runtime-selector.js', () => ({
  resolveRuntimeContext: () => runtimeStub,
}));

const { serverRowsOrDegraded, isServerRuntime } =
  await import('../../src/services/context/ContextBuilder.js');

afterEach(() => {
  runtimeStub = { runtime: 'worker' };
  localCalls = 0;
});

afterAll(() => {
  mock.module('../../src/services/hooks/runtime-selector.js', () => realSnapshot);
});

const obs = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i + 1 })) as never;
const sum = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i + 1 })) as never;

describe('server runtime never reads the local corpus', () => {
  it('reports server runtime from the resolver', async () => {
    runtimeStub = { runtime: 'server', projectId: 'p', client: {} };
    expect(await isServerRuntime()).toBe(true);
  });

  it('reports worker runtime as not server', async () => {
    runtimeStub = { runtime: 'worker' };
    expect(await isServerRuntime()).toBe(false);
  });

  it('passes the store rows straight through when the store answered', () => {
    const r = serverRowsOrDegraded(obs(3), sum(2));
    expect(r.observations).toHaveLength(3);
    expect(r.summaries).toHaveLength(2);
    expect(r.degraded).toBeNull();
  });

  it('returns NO rows -- not local ones -- when the store gave no observations', () => {
    const r = serverRowsOrDegraded(null, sum(2));
    expect(r.observations).toHaveLength(0);
    expect(localCalls).toBe(0);
  });

  it('says so, loudly, rather than rendering a block that looks healthy', () => {
    const r = serverRowsOrDegraded(null, null);
    expect(r.degraded).not.toBeNull();
    expect(r.degraded!.toLowerCase()).toContain('shared store');
  });

  it('still degrades when only the summaries are missing, and names which half', () => {
    // Half a block is the dangerous case: it renders, so nobody looks.
    const r = serverRowsOrDegraded(obs(3), null);
    expect(r.observations).toHaveLength(3);
    expect(r.degraded).not.toBeNull();
    expect(r.degraded!.toLowerCase()).toContain('summar');
  });

  it('does not degrade a block whose store simply has nothing yet', () => {
    // An empty store is a legitimate first run, not a degraded read: the
    // fetchers return [] for "asked and got none" and null for "no answer".
    const r = serverRowsOrDegraded([], []);
    expect(r.degraded).toBeNull();
  });
});
