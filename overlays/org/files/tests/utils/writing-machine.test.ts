import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ServerClient } from '../../src/services/hooks/server-client.js';
import { writingMachineHeaders } from '../../src/utils/writing-machine.js';

const saved = { ...process.env };
afterEach(() => { process.env = { ...saved }; });

function policyDir(content?: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'wm-'));
  if (content !== undefined) writeFileSync(join(dir, 'machine-id'), content);
  return dir;
}

describe('writing-machine header', () => {
  it('reads the pinned machine id file', () => {
    delete process.env.CLAUDE_MEM_WRITING_MACHINE;
    process.env.CLAUDE_POLICY_CONFIG = policyDir('escooterclinic@patryk-macbook\n');
    expect(writingMachineHeaders()).toEqual({ 'X-Claude-Mem-Writing-Machine': 'escooterclinic@patryk-macbook' });
  });
  it('env override wins', () => {
    process.env.CLAUDE_MEM_WRITING_MACHINE = 'ci@runner';
    process.env.CLAUDE_POLICY_CONFIG = policyDir('other@x');
    expect(writingMachineHeaders()['X-Claude-Mem-Writing-Machine']).toBe('ci@runner');
  });
  it('fails open: missing, hostile and oversized ids send nothing', () => {
    delete process.env.CLAUDE_MEM_WRITING_MACHINE;
    process.env.CLAUDE_POLICY_CONFIG = policyDir();
    expect(writingMachineHeaders()).toEqual({});
    process.env.CLAUDE_POLICY_CONFIG = policyDir('a b\r\nX-Evil: 1');
    expect(writingMachineHeaders()).toEqual({});
    process.env.CLAUDE_POLICY_CONFIG = policyDir('a'.repeat(129));
    expect(writingMachineHeaders()).toEqual({});
  });
  it('every ServerClient request carries it', async () => {
    process.env.CLAUDE_MEM_WRITING_MACHINE = 'esc02@host';
    let seen: Record<string, string> = {};
    const orig = globalThis.fetch;
    globalThis.fetch = (async (_u: unknown, init: RequestInit) => {
      seen = init.headers as Record<string, string>;
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    try {
      const c = new ServerClient({ serverBaseUrl: 'http://127.0.0.1:1', apiKey: 'cmem_test' });
      await (c as never as { request: (m: string, p: string) => Promise<unknown> }).request('GET', '/v1/x').catch(() => {});
    } finally { globalThis.fetch = orig; }
    expect(seen['X-Claude-Mem-Writing-Machine']).toBe('esc02@host');
  });
});
