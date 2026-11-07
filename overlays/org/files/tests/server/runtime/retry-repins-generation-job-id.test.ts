// SPDX-License-Identifier: Apache-2.0
//
// ORG OVERLAY (eMobility-Innovations/claude-mem). REGRESSION for the retry route
// republishing a STALE payload.generation_job_id.
//
// A session_summary row whose stored payload names a job id that was minted on an
// idempotent re-create and discarded ON CONFLICT (before the re-pin-on-conflict fix)
// was re-published VERBATIM by POST /v1/jobs/:id/retry. The worker reloads by
// payload.generation_job_id, finds nothing, and the real row sits `queued` forever.
// Measured 2026-11-07 on the org store: 233 such rows, 34 of them failed/unrecoverable.
//
// Delete the re-pin in retryGenerationJob and BOTH assertions below fail: the
// published payload and the persisted payload keep the phantom id.

import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import pg from 'pg';
import { Server } from '../../../src/services/server/Server.js';
import { ServerV1PostgresRoutes } from '../../../src/server/routes/v1/ServerV1PostgresRoutes.js';
import {
  bootstrapServerPostgresSchema,
  createPostgresStorageRepositories,
  type PostgresPoolClient,
  type PostgresStorageRepositories,
} from '../../../src/storage/postgres/index.js';
import { DisabledServerQueueManager } from '../../../src/server/runtime/types.js';
import { logger } from '../../../src/utils/logger.js';
import { quoteIdentifier, newApiKey } from '../../sdk/pg-isolation.js';

const testDatabaseUrl = process.env.CLAUDE_MEM_TEST_POSTGRES_URL;

describe('POST /v1/jobs/:id/retry re-pins payload.generation_job_id to the row id', () => {
  if (!testDatabaseUrl) {
    it.skip('requires CLAUDE_MEM_TEST_POSTGRES_URL', () => {});
    return;
  }

  let pool: pg.Pool;
  let client: PostgresPoolClient;
  let schemaName: string;
  let storage: PostgresStorageRepositories;
  let server: Server;
  let port: number;
  let writeKey: string;
  let jobId: string;
  let added: Array<{ jobId: string; payload: Record<string, unknown> }>;
  let loggerSpies: ReturnType<typeof spyOn>[] = [];
  const phantom = crypto.randomUUID();

  beforeEach(async () => {
    loggerSpies = (['info', 'warn', 'error', 'debug'] as const)
      .map(level => spyOn(logger, level).mockImplementation(() => {}));
    pool = new pg.Pool({ connectionString: testDatabaseUrl });
    client = await pool.connect();
    schemaName = `cm_retry_repin_${crypto.randomUUID().replaceAll('-', '_')}`;
    await client.query(`CREATE SCHEMA ${quoteIdentifier(schemaName)}`);
    await client.query(`SET search_path TO ${quoteIdentifier(schemaName)}`);
    await bootstrapServerPostgresSchema(client);
    pool.on('connect', (c) => {
      c.query(`SET search_path TO ${quoteIdentifier(schemaName)}`).catch(() => {});
    });
    storage = createPostgresStorageRepositories(client);

    const team = await storage.teams.create({ name: 'team-r' });
    const project = await storage.projects.create({ teamId: team.id, name: 'p-r' });
    const material = newApiKey();
    writeKey = material.raw;
    await storage.auth.createApiKey({
      keyHash: material.hash,
      teamId: team.id,
      projectId: null,
      actorId: 'system:retry-repin',
      scopes: ['memories:read', 'memories:write'],
    });

    const session = await storage.sessions.create({ projectId: project.id, teamId: team.id });
    const sessionId = session.id;
    const job = await storage.observationGenerationJobs.create({
      projectId: project.id,
      teamId: team.id,
      sourceType: 'session_summary',
      sourceId: sessionId,
      serverSessionId: sessionId,
      jobType: 'observation_generate_session_summary',
      bullmqJobId: `sum_${sessionId}`,
      payload: {},
    });
    jobId = job.id;
    // The corruption under test: a failed summary row whose stored payload names
    // an id that was never this row's own.
    await client.query(
      `UPDATE observation_generation_jobs
         SET status = 'failed', failed_at = now(), payload = $2::jsonb
       WHERE id = $1`,
      [jobId, JSON.stringify({
        kind: 'summary',
        team_id: team.id,
        project_id: project.id,
        source_type: 'session_summary',
        source_id: sessionId,
        server_session_id: sessionId,
        generation_job_id: phantom,
        api_key_id: null,
        actor_id: null,
        source_adapter: 'api',
        request_id: 'req-original',
      })],
    );

    added = [];
    const fakeQueue = {
      add: async (id: string, payload: Record<string, unknown>) => { added.push({ jobId: id, payload }); },
      remove: async () => {},
    };
    server = new Server({
      getInitializationComplete: () => true,
      getMcpReady: () => true,
      onShutdown: mock(() => Promise.resolve()),
      onRestart: mock(() => Promise.resolve()),
      workerPath: '/test/worker.cjs',
      runtime: 'server-beta',
      getAiStatus: () => ({ provider: 'disabled', authMethod: 'api-key', lastInteraction: null }),
    });
    server.registerRoutes(new ServerV1PostgresRoutes({
      pool: pool as never,
      queueManager: new DisabledServerQueueManager('disabled in tests'),
      authMode: 'api-key',
      getEventQueue: () => null,
      getSummaryQueue: () => fakeQueue as never,
    }));
    server.finalizeRoutes();
    await server.listen(0, '127.0.0.1');
    const address = server.getHttpServer()?.address();
    if (!address || typeof address === 'string') throw new Error('no port');
    port = address.port;
  });

  afterEach(async () => {
    try { await server.close(); } catch (error: unknown) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code;
      if (code !== 'ERR_SERVER_NOT_RUNNING') throw error;
    }
    await client.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schemaName)} CASCADE`);
    client.release();
    await pool.end();
    loggerSpies.forEach(spy => spy.mockRestore());
    mock.restore();
  });

  it('publishes and persists the row id, not the stale pointer', async () => {
    const resp = await fetch(`http://127.0.0.1:${port}/v1/jobs/${jobId}/retry`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${writeKey}`, 'Content-Type': 'application/json' },
    });
    expect(resp.status).toBe(200);
    const body = await resp.json() as { alreadyQueued: boolean; generationJob: { status: string } };
    expect(body.alreadyQueued).toBe(false);
    expect(body.generationJob.status).toBe('queued');

    // What the worker receives: it reloads by this id, so it MUST be the row's own.
    expect(added).toHaveLength(1);
    expect(added[0]!.payload.generation_job_id).toBe(jobId);
    expect(added[0]!.payload.generation_job_id).not.toBe(phantom);

    // What startup reconciliation would re-publish: the stored payload, re-pinned too.
    const stored = await client.query(
      `SELECT payload->>'generation_job_id' AS pointer FROM observation_generation_jobs WHERE id = $1`,
      [jobId],
    );
    expect(stored.rows[0]!.pointer).toBe(jobId);
  });
});
