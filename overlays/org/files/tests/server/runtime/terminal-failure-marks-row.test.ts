// SPDX-License-Identifier: Apache-2.0
//
// ORG OVERLAY (eMobility-Innovations/claude-mem). REGRESSION for a BullMQ job that
// fails terminally BEFORE the generator reaches its Postgres row.
//
// ProviderObservationGenerator.process() reloads and locks the row outside its
// try/catch, so a pool connect error ("timeout exceeded when trying to connect")
// throws past markGenerationFailed. BullMQ spends its attempts, files the job under
// `failed`, and the row stays `queued` forever. Measured 2026-11-08 on the org
// store: 64 such rows, attempts 0, ~15 h old.
//
// Delete the onFailed observer in ActiveServerGenerationWorkerManager and the
// "connect error" and "evicted job" cases below fail: the row stays `queued`.

import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import pg from 'pg';
import { ActiveServerGenerationWorkerManager } from '../../../src/server/runtime/ActiveServerGenerationWorkerManager.js';
import {
  bootstrapServerPostgresSchema,
  createPostgresStorageRepositories,
  type PostgresPoolClient,
} from '../../../src/storage/postgres/index.js';
import { logger } from '../../../src/utils/logger.js';
import { quoteIdentifier } from '../../sdk/pg-isolation.js';

const testDatabaseUrl = process.env.CLAUDE_MEM_TEST_POSTGRES_URL;
const CONNECT_ERROR = 'timeout exceeded when trying to connect';

type Listener = { onFailed?: (id: string | undefined, attempts: number, reason: string) => void };

describe('a terminal BullMQ failure marks its generation row', () => {
  if (!testDatabaseUrl) {
    it.skip('requires CLAUDE_MEM_TEST_POSTGRES_URL', () => {});
    return;
  }

  let pool: pg.Pool;
  let client: PostgresPoolClient;
  let schemaName: string;
  let manager: ActiveServerGenerationWorkerManager;
  let listeners: Record<string, Listener[]>;
  let jobState: string | null | 'throw';
  let rowId: string;
  let loggerSpies: ReturnType<typeof spyOn>[] = [];
  const bullmqJobId = `evt_${crypto.randomUUID().replaceAll('-', '')}`;

  beforeEach(async () => {
    loggerSpies = (['info', 'warn', 'error', 'debug'] as const)
      .map(level => spyOn(logger, level).mockImplementation(() => {}));
    pool = new pg.Pool({ connectionString: testDatabaseUrl });
    client = await pool.connect();
    schemaName = `cm_terminal_fail_${crypto.randomUUID().replaceAll('-', '_')}`;
    await client.query(`CREATE SCHEMA ${quoteIdentifier(schemaName)}`);
    await client.query(`SET search_path TO ${quoteIdentifier(schemaName)}`);
    await bootstrapServerPostgresSchema(client);
    pool.on('connect', (c) => {
      c.query(`SET search_path TO ${quoteIdentifier(schemaName)}`).catch(() => {});
    });
    const storage = createPostgresStorageRepositories(client);
    const team = await storage.teams.create({ name: 'team-t' });
    const project = await storage.projects.create({ teamId: team.id, name: 'p-t' });
    const session = await storage.sessions.create({ projectId: project.id, teamId: team.id });
    const job = await storage.observationGenerationJobs.create({
      projectId: project.id,
      teamId: team.id,
      sourceType: 'session_summary',
      sourceId: session.id,
      serverSessionId: session.id,
      jobType: 'observation_generate_session_summary',
      bullmqJobId,
      payload: {},
    });
    rowId = job.id;

    listeners = { event: [], summary: [] };
    jobState = 'failed';
    const fakeQueue = (lane: string) => ({
      observe: (l: Listener) => { listeners[lane]!.push(l); },
      getJob: async () => {
        if (jobState === 'throw') throw new Error('redis unavailable');
        return jobState === null ? null : { getState: async () => jobState };
      },
      getLockDurationMs: () => 1_000_000_000,
    });
    const queues = { event: fakeQueue('event'), summary: fakeQueue('summary') };
    manager = new ActiveServerGenerationWorkerManager({
      pool: pool as never,
      queueManager: {
        start: () => {},
        getQueue: (lane: 'event' | 'summary') => queues[lane],
      } as never,
      provider: { providerLabel: 'stub' } as never,
      workerId: 'test-worker',
      generatorFactory: () => ({ process: async () => ({}) }) as never,
    });
    manager.start();
  });

  afterEach(async () => {
    await manager.close();
    await client.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schemaName)} CASCADE`);
    client.release();
    await pool.end();
    loggerSpies.forEach(s => s.mockRestore());
  });

  async function setRow(status: string, lastError: Record<string, unknown> | null = null) {
    await client.query(
      'UPDATE observation_generation_jobs SET status = $2, last_error = $3::jsonb WHERE id = $1',
      [rowId, status, lastError === null ? null : JSON.stringify(lastError)],
    );
  }

  async function row(): Promise<{ status: string; last_error: Record<string, string> | null }> {
    const r = await client.query('SELECT status, last_error FROM observation_generation_jobs WHERE id = $1', [rowId]);
    return r.rows[0];
  }

  async function fail(lane = 'event', reason = CONNECT_ERROR) {
    for (const l of listeners[lane]!) l.onFailed?.(bullmqJobId, 3, reason);
    // the listener is fire-and-forget: give it a bounded moment to land
    for (let i = 0; i < 40; i++) {
      if ((await row()).status !== 'queued') return;
      await new Promise(r => setTimeout(r, 25));
    }
  }

  it('marks a queued row failed/transient when the job failed on a connect error', async () => {
    await fail();
    const r = await row();
    expect(r.status).toBe('failed');
    expect(r.last_error?.classification).toBe('transient');
    expect(r.last_error?.message).toContain(CONNECT_ERROR);
  });

  it('marks the row when the failed job was already evicted', async () => {
    jobState = null;
    await fail();
    expect((await row()).status).toBe('failed');
  });

  it('leaves the row alone while BullMQ still has a retry (delayed)', async () => {
    jobState = 'delayed';
    await fail();
    expect((await row()).status).toBe('queued');
  });

  it('never touches a row that already completed', async () => {
    await setRow('completed');
    await fail();
    expect((await row()).status).toBe('completed');
  });

  it('keeps an existing classification', async () => {
    await setRow('queued', { classification: 'rate_limit', message: 'slow down' });
    await fail();
    const r = await row();
    expect(r.status).toBe('failed');
    expect(r.last_error?.classification).toBe('rate_limit');
  });

  it('swallows a Redis error and leaves the row for the host requeuer', async () => {
    jobState = 'throw';
    await fail();
    expect((await row()).status).toBe('queued');
  });

  it('is wired on the summary lane too', async () => {
    await fail('summary');
    expect((await row()).status).toBe('failed');
  });
});
