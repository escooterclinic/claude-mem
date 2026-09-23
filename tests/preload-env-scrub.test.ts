import { describe, it, expect } from 'bun:test';
import { spawnSync } from 'child_process';
import { join } from 'path';

/**
 * Guard for the ambient-settings scrub in tests/preload.ts: run a
 * default-asserting suite in a child bun with a hostile CLAUDE_MEM_* value in
 * its env. Without the scrub the child goes red (the value overrides the
 * default it asserts); with it the child passes.
 */
describe('preload ambient CLAUDE_MEM_* scrub', () => {
  it('keeps a hostile ambient setting out of the defaults tests assert on', () => {
    const repoRoot = join(import.meta.dir, '..');
    const child = spawnSync(
      process.execPath,
      ['test', './tests/shared/settings-defaults-manager.test.ts'],
      {
        cwd: repoRoot,
        env: { ...process.env, CLAUDE_MEM_HOOK_FAIL_LOUD_THRESHOLD: '1000000000' },
        encoding: 'utf-8',
        timeout: 25_000,
      },
    );
    expect(`${child.stdout}${child.stderr}`).toContain(' 0 fail');
    expect(child.status).toBe(0);
  }, 30_000);
});
