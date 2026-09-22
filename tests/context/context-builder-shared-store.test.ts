import { afterAll, afterEach, describe, expect, it, mock } from 'bun:test';

import * as realRuntimeSelector from '../../src/services/hooks/runtime-selector.js';
import { CONTEXT_LIMIT_MAX } from '../../src/shared/context-limits.js';

/**
 * In `server` runtime the session-start block must be built from the SHARED store.
 *
 * MEASURED 2026-09-17: the local corpus took 1 observation in 24h while the store
 * took 18,184. Nothing errored -- the client has shipped contextObservations() ->
 * POST /v1/context all along and nothing called it, so a session simply opened onto
 * a corpus frozen where server mode began.
 *
 * THE FIX REPLACES THE ROW SOURCE, NOT THE OUTPUT, and these tests pin that choice.
 * The first attempt injected the route's pre-joined `context` string straight into
 * the hook result: it bypassed fitContextToBudget and came back at 52,337 characters
 * against a CONTEXT_OUTPUT_LIMIT of 10,000, losing the header, the ids and the stats
 * -- 13,084 tokens where the local block spent 1,787. Returning ROWS keeps the
 * renderer, the budget fitter and the token counter exactly as they were.
 */

const realSnapshot = { ...realRuntimeSelector };

let contextCalls: Array<Record<string, unknown>> = [];
let runtimeStub: unknown = { runtime: 'worker' };
let impl: (i: Record<string, unknown>) => Promise<unknown> = async () => ({ observations: [] });

mock.module('../../src/services/hooks/runtime-selector.js', () => ({
  resolveRuntimeContext: () => runtimeStub,
}));

const { fetchServerObservations, fetchServerSummaries, toLocalObservationShape } =
  await import('../../src/services/context/ContextBuilder.js');

const serverRuntime = () => ({
  runtime: 'server',
  projectId: 'demo-project',
  serverBaseUrl: 'http://memory.example:37878',
  client: {
    contextObservations: async (i: Record<string, unknown>) => { contextCalls.push(i); return impl(i); },
  },
});

const cfg = (n: number) => ({ totalObservationCount: n } as never);

afterEach(() => {
  contextCalls = [];
  runtimeStub = { runtime: 'worker' };
  impl = async () => ({ observations: [] });
});

// bun re-points a mocked module for the WHOLE run, so leaving this stub in place
// fails tests/hooks/runtime-selector.test.ts in any file that happens to run after
// this one -- measured: 4 failures, none of them in this file. The namespace is
// snapshotted eagerly above, before the mock, for the same reason.
afterAll(() => {
  mock.module('../../src/services/hooks/runtime-selector.js', () => realSnapshot);
});

describe('the shared store as a row source', () => {
  it('returns rows in server runtime', async () => {
    runtimeStub = serverRuntime();
    impl = async () => ({ observations: [{ id: 'x', content: 'Fixed the read path', kind: 'bugfix', createdAtEpoch: 1_760_000_000_000 }] });
    const rows = await fetchServerObservations(cfg(20), 'p', undefined);
    expect(rows).not.toBeNull();
    expect(rows!).toHaveLength(1);
    expect(rows![0].title).toBe('Fixed the read path');
  });

  it('omits `query` ENTIRELY -- the key is what selects recency over relevance', async () => {
    runtimeStub = serverRuntime();
    impl = async () => ({ observations: [{ id: 'x', content: 'c', createdAtEpoch: 1 }] });
    await fetchServerObservations(cfg(20), 'p', undefined);
    // Not `query: ''` -- the route rejects an empty string (min 1 char) and ranks
    // by FTS when one is present. Absent is the only thing that means "newest".
    expect(Object.prototype.hasOwnProperty.call(contextCalls[0], 'query')).toBe(false);
  });

  it('clamps the limit to what the route accepts', async () => {
    runtimeStub = serverRuntime();
    impl = async () => ({ observations: [{ id: 'x', content: 'c', createdAtEpoch: 1 }] });
    await fetchServerObservations(cfg(500), 'p', undefined);
    // The route REFUSES above its ceiling: unclamped this does not degrade, it
    // fails empty. Asserted against the SHARED constant rather than a literal --
    // the ceiling was 50, moved to 200, and a literal here is how the client and
    // the route come to disagree without either test going red.
    expect(contextCalls[0].limit).toBe(CONTEXT_LIMIT_MAX);
  });

  it('falls back to null when the store throws', async () => {
    runtimeStub = serverRuntime();
    impl = async () => { throw new Error('ECONNREFUSED'); };
    expect(await fetchServerObservations(cfg(20), 'p', undefined)).toBeNull();
  });

  it('falls back to null on an empty answer rather than rendering an empty memory', async () => {
    runtimeStub = serverRuntime();
    impl = async () => ({});
    expect(await fetchServerObservations(cfg(20), 'p', undefined)).toBeNull();
  });

  it('never consults the store in worker runtime', async () => {
    runtimeStub = { runtime: 'worker' };
    expect(await fetchServerObservations(cfg(20), 'p', undefined)).toBeNull();
    expect(contextCalls).toHaveLength(0);
  });
});

describe('the row shape the renderer is handed', () => {
  it('carries `kind` into `type`, not the literal "observation"', () => {
    // `type` drives the emoji and the type histogram. Defaulting it would render
    // every memory as the same kind and quietly flatten the legend.
    const r = toLocalObservationShape({ id: 'a', kind: 'bugfix', content: 'x', createdAtEpoch: 1 }, 0, 'p', undefined);
    expect(r.type).toBe('bugfix');
  });

  it('stringifies the JSON columns, because the local schema stores strings', () => {
    // The writer calls JSON.stringify on each of these. Handing the renderer raw
    // arrays changes what the token counter measures and skews the savings stats.
    const r = toLocalObservationShape(
      { id: 'a', content: 'x', createdAtEpoch: 1, metadata: { facts: ['one', 'two'], concepts: ['c'] } },
      0, 'p', undefined,
    );
    expect(typeof r.facts).toBe('string');
    expect(JSON.parse(r.facts as string)).toEqual(['one', 'two']);
    expect(typeof r.concepts).toBe('string');
  });

  it('titles a row from its first line when the store carries no title', () => {
    const r = toLocalObservationShape({ id: 'a', content: 'First line\nrest of it', createdAtEpoch: 1 }, 0, 'p', undefined);
    expect(r.title).toBe('First line');
  });
});

describe('the row shape mirrors the compiler SELECT, field for field', () => {
  // queryObservationsMulti selects exactly: id, memory_session_id, platform_source,
  // type, title, subtitle, narrative, facts, concepts, files_read, files_modified,
  // discovery_tokens, created_at, created_at_epoch, project. A hub row that carries
  // a DIFFERENT set is not a drop-in: the renderer reads discovery_tokens for the
  // savings stats, and fields nobody reads are dead weight the token counter still
  // has to be reasoned about.
  const SELECTED = [
    'id', 'memory_session_id', 'platform_source', 'type', 'title', 'subtitle',
    'narrative', 'facts', 'concepts', 'files_read', 'files_modified',
    'discovery_tokens', 'created_at', 'created_at_epoch', 'project',
  ].sort();

  it('carries every field the compiler selects and no others', () => {
    const r = toLocalObservationShape({ id: 'a', kind: 'bugfix', content: 'x', createdAtEpoch: 1 }, 0, 'p', undefined);
    expect(Object.keys(r).sort()).toEqual(SELECTED);
  });

  it('reports discovery_tokens as null, because the shared store does not record it', () => {
    // MEASURED 2026-09-23 against the hub: no observation metadata key named
    // discovery_tokens exists in 347,146 rows. Defaulting it to 0 would let the
    // economics block print "0% savings" as though it had measured something.
    const r = toLocalObservationShape({ id: 'a', content: 'x', createdAtEpoch: 1 }, 0, 'p', undefined);
    expect(r.discovery_tokens).toBeNull();
  });
});

describe('summaries come from the shared store too', () => {
  it('maps a hub summary row onto the local SessionSummary shape', async () => {
    runtimeStub = serverRuntime();
    impl = async () => ({ observations: [{
      id: 's1', kind: 'summary', content: 'Request: do the thing', createdAtEpoch: 1_760_000_000_000,
      serverSessionId: 'sess-1',
      metadata: {
        request: 'do the thing', investigated: 'looked', learned: 'a lot',
        completed: 'it', next_steps: 'none',
      },
    }] });
    const rows = await fetchServerSummaries(cfg(20), 'p', undefined);
    expect(rows).not.toBeNull();
    expect(rows!).toHaveLength(1);
    expect(rows![0].request).toBe('do the thing');
    expect(rows![0].investigated).toBe('looked');
    expect(rows![0].learned).toBe('a lot');
    expect(rows![0].completed).toBe('it');
    expect(rows![0].next_steps).toBe('none');
    expect(rows![0].memory_session_id).toBe('sess-1');
  });

  it('asks the route for the summary kind ONLY', async () => {
    // Without the filter the newest N rows are overwhelmingly observations and a
    // summary may not appear at all -- 503 summaries against 347,146 observations
    // on the hub, measured 2026-09-23.
    runtimeStub = serverRuntime();
    impl = async () => ({ observations: [] });
    await fetchServerSummaries(cfg(20), 'p', undefined);
    expect(contextCalls[0].kind).toBe('summary');
  });

  it('keeps summaries OUT of the observation list', async () => {
    runtimeStub = serverRuntime();
    impl = async () => ({ observations: [{ id: 'x', content: 'c', createdAtEpoch: 1 }] });
    await fetchServerObservations(cfg(20), 'p', undefined);
    expect(contextCalls[0].excludeKind).toBe('summary');
  });
});
