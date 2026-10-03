import { afterAll, describe, expect, it } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const fixture = mkdtempSync(join(tmpdir(), 'session-repo-identity-'));
afterAll(() => rmSync(fixture, { recursive: true, force: true }));

function runHandler(cwd: string): Record<string, unknown> {
  const script = `
    const { sessionInitHandler, setSessionInitDependenciesForTesting } = await import('./src/cli/handlers/session-init.ts');
    const { ServerClient } = await import('./src/services/hooks/server-client.ts');
    let captured;
    const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: async request => {
      if (new URL(request.url).pathname !== '/v1/sessions/start') throw new Error('wrong route');
      captured = await request.json();
      return Response.json({ session: { id: 'server-session' } });
    }});
    delete process.env.CLAUDE_MEM_INTERNAL;
    setSessionInitDependenciesForTesting({
      loadFromFileOnce: () => ({ CLAUDE_MEM_EXCLUDED_PROJECTS: '', CLAUDE_MEM_RUNTIME: 'server', CLAUDE_MEM_SEMANTIC_INJECT: 'false' }),
      resolveRuntimeContext: () => ({ runtime: 'server', projectId: 'project-id', serverBaseUrl: server.url.toString(),
        client: new ServerClient({ serverBaseUrl: server.url.toString(), apiKey: 'test-key' }) }),
      shouldTrackProject: () => true,
    });
    await sessionInitHandler.execute({ sessionId: 'session-id', cwd: ${JSON.stringify(cwd)}, platform: 'claude-code', prompt: 'hello', agentId: 'agent-id', agentType: 'claude' });
    server.stop(true);
    if (!captured) throw new Error('session request missing');
    console.log(JSON.stringify(captured));
  `;
  const result = Bun.spawnSync([process.execPath, '--eval', script], {
    cwd: process.cwd(), env: { ...process.env, CLAUDE_MEM_LOG_LEVEL: 'ERROR' }, stdout: 'pipe', stderr: 'pipe',
  });
  expect(result.exitCode).toBe(0);
  return JSON.parse(new TextDecoder().decode(result.stdout).trim());
}

describe('session-init repo identity on the HTTP wire', () => {
  it('sends a top-level field from the session cwd origin', () => {
    const cwd = join(fixture, 'nexus');
    execFileSync('git', ['init', '-q', cwd]);
    execFileSync('git', ['-C', cwd, 'remote', 'add', 'origin', 'https://github.com/eMobility-Innovations/nexus.git']);
    expect(runHandler(cwd)).toEqual({
      projectId: 'project-id', externalSessionId: 'session-id', contentSessionId: 'session-id',
      agentId: 'agent-id', agentType: 'claude', platformSource: 'claude',
      metadata: { project: 'nexus', prompt: 'hello' }, repo_identity: 'github.com/eMobility-Innovations/nexus',
    });
  });
  it.each(['missing', 'no-origin', 'local-origin'])('omits the field for %s', kind => {
    const cwd = join(fixture, kind);
    if (kind !== 'missing') execFileSync('git', ['init', '-q', cwd]);
    if (kind === 'local-origin') execFileSync('git', ['-C', cwd, 'remote', 'add', 'origin', '/tmp/Org/Repo']);
    const body = runHandler(cwd);
    expect(Object.hasOwn(body, 'repo_identity')).toBe(false);
    expect(Object.hasOwn(body.metadata as object, 'repo_identity')).toBe(false);
  });
});
