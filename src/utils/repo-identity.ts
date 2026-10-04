import { execFileSync } from 'node:child_process';

/** Normalize an origin without retaining credentials, transport or ports. */
export function canonicalRepoIdentity(
  remoteUrl: string,
  resolveAlias: (host: string) => string | undefined,
): string | undefined {
  try {
    if (!remoteUrl || /\s/.test(remoteUrl)) return undefined;
    const parsed = parseRemote(remoteUrl);
    if (!parsed) return undefined;
    const [host, path, ssh] = parsed;
    if (!/^[a-z0-9][a-z0-9.-]*$/i.test(host)) return undefined;
    const resolved = ssh ? resolveAlias(host) : host;
    if (!resolved || !/^[a-z0-9][a-z0-9.-]*$/i.test(resolved)) return undefined;
    const canonicalHost = resolved.toLowerCase();
    return `${canonicalHost === 'ssh.github.com' ? 'github.com' : canonicalHost}/${path}`;
  } catch {
    return undefined;
  }
}

function parseRemote(remote: string): [string, string, boolean] | undefined {
  if (remote.includes('://')) {
    const url = new URL(remote);
    if (!['https:', 'http:', 'ssh:', 'git:'].includes(url.protocol) || url.search || url.hash) return undefined;
    // URL normalizes dot segments, so reject those before parsing the path.
    if (/\/(?:\.|\.\.)(?:\/|$)/.test(remote)) return undefined;
    const path = repoPath(url.pathname.slice(1));
    return path ? [url.hostname, path, url.protocol === 'ssh:'] : undefined;
  }
  const scp = /^(?:[^@/:]+@)?([a-z0-9][a-z0-9.-]*):([^\\]+)$/i.exec(remote);
  if (!scp || /^[a-z]:/i.test(remote)) return undefined;
  const path = repoPath(scp[2]);
  return path ? [scp[1], path, true] : undefined;
}

function repoPath(path: string): string | undefined {
  const cleaned = path.replace(/\.git$/, '');
  const parts = cleaned.split('/');
  if (parts.length !== 2 || parts.some(part => !part || part === '.' || part === '..' || /[?#\\%]/.test(part))) return undefined;
  return cleaned;
}

/** Both subprocesses share a sub-second budget; discovery is always fail-open. */
export function repoIdentityFromCwd(cwd: string): string | undefined {
  const deadline = Date.now() + 800;
  const run = (command: string, args: string[]) => execFileSync(command, args, {
    encoding: 'utf8', killSignal: 'SIGKILL', timeout: Math.min(400, Math.max(1, deadline - Date.now())),
    maxBuffer: 128 * 1024, stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
  try {
    const remote = run('git', ['-C', cwd, 'remote', 'get-url', 'origin']);
    return canonicalRepoIdentity(remote, host => {
      if (Date.now() >= deadline) return undefined;
      const config = run('ssh', ['-G', host]);
      return /^hostname\s+(\S+)\s*$/im.exec(config)?.[1];
    });
  } catch {
    return undefined;
  }
}
