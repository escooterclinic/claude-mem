import { describe, expect, it } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalRepoIdentity, repoIdentityFromCwd } from '../../src/utils/repo-identity.js';

describe('canonicalRepoIdentity', () => {
  it.each([
    ['https://github.com/eMobility-Innovations/nexus.git', 'github.com/eMobility-Innovations/nexus'],
    ['git@github.com:Org/Repo.git', 'github.com/Org/Repo'],
    ['ssh://git@ssh.github.com:443/Org/Repo', 'github.com/Org/Repo'],
    ['git@github-nexus:eMobility-Innovations/nexus.git', 'github.com/eMobility-Innovations/nexus'],
    ['https://USER@GITHUB.COM:8443/Org/Repo.git', 'github.com/Org/Repo'],
  ])('normalizes %s', (remote, expected) => {
    expect(canonicalRepoIdentity(remote, host => host === 'github-nexus' ? 'github.com' : host)).toBe(expected);
  });
  it.each(['', '/tmp/Org/Repo', '../Org/Repo', './Org/Repo', 'file:///tmp/Org/Repo', 'C:\\Org\\Repo', 'not a remote', 'https://github.com/Repo', 'https://github.com/Org/Repo?token=secret', 'git@-bad:Org/Repo', 'ssh://-bad/Org/Repo', 'https://github.com/Org/../Repo'])('omits %s', remote => {
    expect(canonicalRepoIdentity(remote, host => host)).toBeUndefined();
  });
  it('swallows alias resolution failures', () => {
    expect(canonicalRepoIdentity('git@github-nexus:Org/Repo', () => { throw new Error('failed'); })).toBeUndefined();
    expect(canonicalRepoIdentity('git@github-nexus:Org/Repo', () => undefined)).toBeUndefined();
  });
  it('omits missing cwd and missing origin', () => {
    expect(repoIdentityFromCwd('/nonexistent/repo-identity')).toBeUndefined();
  });
});

describe('bounded cwd discovery', () => {
  it.each(['git', 'ssh'])('bounds a hung %s command and omits the identity', command => {
    const fixture = mkdtempSync(join(tmpdir(), 'repo-timeout-'));
    try {
      const bin = join(fixture, 'bin');
      mkdirSync(bin);
      writeFileSync(join(bin, 'git'), '#!/bin/sh\n' + (command === 'git' ? "trap '' TERM\nwhile :; do :; done\n" : 'echo git@github-alias:Org/Repo\n'), { mode: 0o755 });
      writeFileSync(join(bin, 'ssh'), '#!/bin/sh\nexec /bin/sleep 5\n', { mode: 0o755 });
      const script = `const { repoIdentityFromCwd } = await import('./src/utils/repo-identity.ts'); const start = Date.now(); console.log(JSON.stringify({ identity: repoIdentityFromCwd('/tmp'), elapsed: Date.now() - start }));`;
      const result = Bun.spawnSync([process.execPath, '--eval', script], { env: { ...process.env, PATH: bin }, stdout: 'pipe', stderr: 'pipe' });
      expect(result.exitCode).toBe(0);
      const measured = JSON.parse(new TextDecoder().decode(result.stdout));
      expect(measured.identity).toBeUndefined();
      expect(measured.elapsed).toBeLessThan(1000);
    } finally { rmSync(fixture, { recursive: true, force: true }); }
  });
  it('reads the hostname from ssh -G for an alias', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'repo-alias-'));
    try {
      writeFileSync(join(fixture, 'git'), '#!/bin/sh\n[ "$1" = "-C" ] && [ "$2" = "/session/cwd" ] && [ "$3" = "remote" ] && [ "$4" = "get-url" ] && [ "$5" = "origin" ] || exit 1\necho git@github-nexus:eMobility-Innovations/nexus.git\n', { mode: 0o755 });
      writeFileSync(join(fixture, 'ssh'), '#!/bin/sh\n[ "$1" = "-G" ] && [ "$2" = "github-nexus" ] || exit 1\necho "hostname github.com"\n', { mode: 0o755 });
      const script = `const { repoIdentityFromCwd } = await import('./src/utils/repo-identity.ts'); console.log(repoIdentityFromCwd('/session/cwd'));`;
      const result = Bun.spawnSync([process.execPath, '--eval', script], { env: { ...process.env, PATH: fixture }, stdout: 'pipe', stderr: 'pipe' });
      expect(result.exitCode).toBe(0);
      expect(new TextDecoder().decode(result.stdout).trim()).toBe('github.com/eMobility-Innovations/nexus');
    } finally { rmSync(fixture, { recursive: true, force: true }); }
  });
});
