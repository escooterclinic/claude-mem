// IO discipline (see src/shared/hook-io.ts):
// - hookSpecificOutput.additionalContext → MODEL_CONTEXT (model consumes; via stdout JSON)
// - systemMessage                        → USER_HINT (user-visible; via stdout JSON systemMessage)
// This handler is PURE: it returns a HookResult and MUST NOT call
// process.stderr.write / process.stdout.write / console.* / process.exit.
// logger.* calls are DIAGNOSTIC and route through hook-io's stderr path.
import type { EventHandler, NormalizedHookInput, HookResult } from '../types.js';
import {
  executeWithWorkerFallback,
  isWorkerFallback,
  getWorkerPort,
} from '../../shared/worker-utils.js';
import { getProjectContext } from '../../utils/project-name.js';
import { HOOK_EXIT_CODES, HOOK_TIMEOUTS } from '../../shared/hook-constants.js';
import { logger } from '../../utils/logger.js';
import { loadFromFileOnce } from '../../shared/hook-settings.js';
import { shouldTrackProject } from '../../shared/should-track-project.js';
import { readStaleMarker } from '../../shared/oauth-token.js';
import { normalizePlatformSource } from '../../shared/platform-source.js';
import { resolveRuntimeContext } from '../../services/hooks/runtime-selector.js';
import { proTrialLine, proTrialUrl, PLAN_USAGE_GAIN_PERCENT } from '../../shared/pro-promo.js';
import {
  hasShownProFallbackNotice,
  isCmemGatewayUrl,
  markProFallbackNoticeShown,
  trialDaysRemaining,
} from '../../shared/cmem-gateway.js';


// The route caps `limit` at 50 and REFUSES above it with a ValidationError, so a
// larger CLAUDE_MEM_CONTEXT_OBSERVATIONS must be clamped HERE. Unclamped, the
// session-start read does not degrade -- it fails, and the block comes back empty.
const SERVER_CONTEXT_MAX_OBSERVATIONS = 50;

/**
 * The session-start context, read from the SHARED store, or null to fall back.
 *
 * In `server` runtime every WRITE goes to the shared store while this READ went to
 * the worker, which renders the per-machine SQLite corpus. Both halves shipped and
 * were never joined: the client has had `contextObservations()` -> POST /v1/context
 * all along and NOTHING called it. A machine in that state looks entirely healthy --
 * sessions start, memory is captured, and the block simply shows a corpus frozen
 * wherever server mode began. There is no error to notice, which is the whole fault.
 *
 * MEASURED 2026-09-17: the local corpus took 1 observation in 24h; the shared store
 * took 18,184 in the same window and held 312,149 against the local file's 127,934.
 *
 * Returning null (never throwing) is deliberate: a store that is down, slow or
 * misconfigured must degrade to the local corpus, which is stale but real. A
 * session-start hook that throws costs the user their memory block entirely.
 */
async function sharedStoreContext(input: NormalizedHookInput): Promise<string | null> {
  let runtime;
  try {
    runtime = resolveRuntimeContext();
  } catch (error) {
    logger.warn('HOOK', '[server-fallback] runtime could not be resolved for session-start context', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
  if (runtime.runtime !== 'server') return null;

  const settings = loadFromFileOnce();
  const configured = Number.parseInt(settings.CLAUDE_MEM_CONTEXT_OBSERVATIONS ?? '', 10);
  const limit = Number.isFinite(configured) && configured > 0
    ? Math.min(configured, SERVER_CONTEXT_MAX_OBSERVATIONS)
    : undefined;

  try {
    const result = await runtime.client.contextObservations({
      projectId: runtime.projectId,
      // NO `query` KEY AT ALL. With one the route answers by FTS relevance; with
      // the key absent it answers by recency, which is what session-start is.
      // `query: ''` is NOT the same and is rejected by the route's schema.
      ...(limit !== undefined ? { limit } : {}),
      ...(input.platform ? { platformSource: normalizePlatformSource(input.platform) } : {}),
    });
    // The client casts the JSON without validating it, so an empty 200 arrives as
    // `{}` and `.context` may simply be absent. Treat that as "no answer" and fall
    // back, rather than injecting an empty block that looks like an empty memory.
    const text = typeof result?.context === 'string' ? result.context.trim() : '';
    if (!text) {
      logger.warn('HOOK', '[server-fallback] shared store returned no context; using the local corpus', {
        projectId: runtime.projectId,
        observations: Array.isArray(result?.observations) ? result.observations.length : 0,
      });
      return null;
    }
    return text;
  } catch (error) {
    logger.warn('HOOK', '[server-fallback] session-start context fell back to the local corpus', {
      projectId: runtime.projectId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export const contextHandler: EventHandler = {
  async execute(input: NormalizedHookInput): Promise<HookResult> {
    const cwd = input.cwd ?? process.cwd();

    // Honor CLAUDE_MEM_EXCLUDED_PROJECTS on the inject/read path too. The
    // write path (ingestObservation) already skips excluded projects, but the
    // SessionStart summary was injected regardless — so an excluded dir (e.g.
    // "~") still got a context dump on every new session. Suppress it here.
    if (!shouldTrackProject(cwd)) {
      return {
        hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: '' },
        exitCode: HOOK_EXIT_CODES.SUCCESS,
      };
    }

    const context = getProjectContext(cwd);
    const port = getWorkerPort();

    const settings = loadFromFileOnce();
    // Codex already receives the timeline through additionalContext. Repeating
    // it as systemMessage can push SessionStart stdout past Codex's hook-output
    // limit, causing Codex to discard the entire payload (including context).
    const showTerminalOutput =
      settings.CLAUDE_MEM_CONTEXT_SHOW_TERMINAL_OUTPUT === 'true'
      && input.platform !== 'codex';

    const projectsParam = context.allProjects.join(',');
    const normalizedPlatformSource = input.platform
      ? normalizePlatformSource(input.platform)
      : undefined;
    const platformSourceParam = input.platform
      ? `&platformSource=${encodeURIComponent(normalizedPlatformSource!)}`
      : '';
    const apiPath = `/api/context/inject?projects=${encodeURIComponent(projectsParam)}${platformSourceParam}`;
    const colorApiPath = input.platform === 'claude-code' ? `${apiPath}&colors=true` : apiPath;

    const emptyResult: HookResult = {
      hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: '' },
      exitCode: HOOK_EXIT_CODES.SUCCESS,
    };

    // ponytail: Codex's MCP normally starts the worker; this one bounded
    // fallback covers cold sessions without the old startup process chain.
    const workerOptions = input.platform === 'codex'
      ? { workerStartupTimeoutMs: HOOK_TIMEOUTS.POST_SPAWN_WAIT, timeoutMs: 2_000 }
      : undefined;
    // THE SHARED STORE IS ASKED FIRST IN SERVER RUNTIME, and the worker is the
    // fallback rather than the default. Null means "no answer from the store" --
    // wrong runtime, unreachable, or an empty body -- and the local corpus, stale
    // but real, is better than no memory block at all.
    const sharedContext = await sharedStoreContext(input);

    let additionalContext: string;
    if (sharedContext !== null) {
      additionalContext = sharedContext;
    } else {
      const contextResult = await executeWithWorkerFallback<string>(apiPath, 'GET', undefined, workerOptions);
      if (isWorkerFallback(contextResult)) {
        return emptyResult;
      }

      if (typeof contextResult === 'string') {
        additionalContext = contextResult.trim();
      } else if (contextResult === undefined) {
        additionalContext = '';
      } else {
        logger.warn('HOOK', 'Context response was not a string', { type: typeof contextResult });
        return emptyResult;
      }
    }

    // Issue #2215: surface stale OAuth token marker as a session-start hint.
    // Marker is written by EnvManager.buildIsolatedEnvWithFreshOAuth() when
    // a previous worker spawn detected an expired keychain entry.
    const staleReason = readStaleMarker();
    if (staleReason) {
      const hint = `[claude-mem] Claude Desktop OAuth token is stale: ${staleReason}\nPlease re-login via Claude Desktop to refresh the token.`;
      additionalContext = additionalContext
        ? `${hint}\n\n${additionalContext}`
        : hint;
    }

    // Trial-expiry fallback notice (plan 2026-08-26 Phase 6): the worker wrote
    // CLAUDE_MEM_PRO_FALLBACK_AT when the cmem gateway terminally rejected the
    // delivered key, and dispatch now runs memory on the Anthropic plan. Tell
    // the user exactly once (DATA_DIR marker file, oauth-stale pattern); the
    // marker resets whenever the fallback is cleared.
    const fallbackActive = settings.CLAUDE_MEM_PRO_FALLBACK_AT !== ''
      && settings.CLAUDE_MEM_PROVIDER === 'openrouter'
      && isCmemGatewayUrl(settings.CLAUDE_MEM_OPENROUTER_BASE_URL);
    if (fallbackActive && !hasShownProFallbackNotice()) {
      const fallbackNotice = 'Your claude-mem free trial ended — memory now runs on your Anthropic plan.\n'
        + `Keep it off-plan (up to ${PLAN_USAGE_GAIN_PERCENT}% more usage): ${proTrialUrl('fallback')}`;
      additionalContext = additionalContext
        ? `${fallbackNotice}\n\n${additionalContext}`
        : fallbackNotice;
      markProFallbackNoticeShown();
    }

    let coloredTimeline = '';
    // The colour route is the WORKER rendering the local corpus. Fetching it when
    // the model was just handed the shared store's text would print one memory to
    // the human and inject a different one into the session.
    if (showTerminalOutput && sharedContext === null) {
      const colorResult = await executeWithWorkerFallback<string>(colorApiPath, 'GET', undefined, workerOptions);
      if (!isWorkerFallback(colorResult) && typeof colorResult === 'string') {
        coloredTimeline = colorResult.trim();
      }
    }

    const platform = input.platform;

    // Antigravity CLI (like the former Gemini CLI) is hooks-based, not an
    // MCP-context-fetch platform like Codex — colorApiPath never populates
    // coloredTimeline for it (colors are claude-code-only above), so fall
    // back to the plain additionalContext for terminal display.
    // With the shared store answering there is no coloured render to show, so the
    // terminal gets the same plain text the model got rather than nothing.
    const displayContent = coloredTimeline
      || ((platform === 'antigravity-cli' || (sharedContext !== null && showTerminalOutput))
        ? additionalContext
        : '');

    // Days-remaining nicety: while the free trial is active (plan 'trial', an
    // end date stored, no fallback), append the countdown. Computed locally —
    // no network — and display-only: nothing is enabled or disabled by it.
    const daysLeft = !fallbackActive && settings.CLAUDE_MEM_PRO_PLAN === 'trial'
      ? trialDaysRemaining(settings.CLAUDE_MEM_PRO_TRIAL_ENDS_AT)
      : null;
    const trialDaysLine = daysLeft !== null && daysLeft >= 0
      ? `claude-mem free trial: ${daysLeft} day${daysLeft === 1 ? '' : 's'} left`
      : null;

    const systemMessage = showTerminalOutput && displayContent
      ? `${displayContent}\n\nView Observations Live @ http://localhost:${port}\n${proTrialLine('session-start')}${trialDaysLine ? `\n${trialDaysLine}` : ''}`
      : undefined;

    return {
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext
      },
      systemMessage
    };
  }
};
