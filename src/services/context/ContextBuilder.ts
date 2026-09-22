
import path from 'path';
import { homedir } from 'os';
import { existsSync, unlinkSync } from 'fs';
import { Database } from 'bun:sqlite';
import { DB_PATH } from '../../shared/paths.js';
import { logger } from '../../utils/logger.js';
import { getProjectContext } from '../../utils/project-name.js';
import { normalizePlatformSource } from '../../shared/platform-source.js';
import { CONTEXT_LIMIT_MAX } from '../../shared/context-limits.js';
import { SQLITE_BUSY_TIMEOUT_MS } from '../sqlite/connection.js';

import type { ContextInput, ContextConfig, Observation, SessionSummary } from './types.js';
import { colors } from './types.js';
import { loadContextConfig } from './ContextConfigLoader.js';
import { fitContextToBudget, CONTEXT_OUTPUT_LIMIT } from './ContextBudget.js';
import { calculateTokenEconomics } from './TokenCalculator.js';
import {
  queryObservationsMulti,
  querySummariesMulti,
  getPriorSessionMessages,
  prepareSummariesForTimeline,
  buildTimeline,
  getFullObservationIds,
} from './ObservationCompiler.js';
import { renderHeader } from './sections/HeaderRenderer.js';
import { renderTimeline } from './sections/TimelineRenderer.js';
import { shouldShowSummary, renderSummaryFields } from './sections/SummaryRenderer.js';
import { renderPreviouslySection, renderFooter } from './sections/FooterRenderer.js';
import { renderAgentEmptyState } from './formatters/AgentFormatter.js';
import { renderHumanEmptyState } from './formatters/HumanFormatter.js';
import {
  readObserverHealth,
  isObserverUnhealthy,
  isObserverQuotaCooldownActive,
  renderObserverHealthWarning,
  renderObserverQuotaCooldownNotice,
} from '../../shared/observer-health.js';

const VERSION_MARKER_PATH = path.join(
  homedir(),
  '.claude',
  'plugins',
  'marketplaces',
  'thedotmack',
  'plugin',
  '.install-version'
);

function initializeDatabase(): Database | null {
  try {
    if (!existsSync(DB_PATH)) return null;
    const db = new Database(DB_PATH, { readonly: true, create: false });
    try {
      db.run(`PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);
      return db;
    } catch (error) {
      db.close();
      throw error;
    }
  } catch (error: unknown) {
    if (error instanceof Error && (error as NodeJS.ErrnoException).code === 'ERR_DLOPEN_FAILED') {
      try {
        unlinkSync(VERSION_MARKER_PATH);
      } catch (unlinkError) {
        if (unlinkError instanceof Error) {
          logger.debug('WORKER', 'Marker file cleanup failed (may not exist)', {}, unlinkError);
        } else {
          logger.debug('WORKER', 'Marker file cleanup failed (may not exist)', { error: String(unlinkError) });
        }
      }
      logger.error('WORKER', 'Native module rebuild needed - restart Claude Code to auto-fix');
      return null;
    }
    throw error;
  }
}

function renderEmptyState(project: string, forHuman: boolean): string {
  return forHuman ? renderHumanEmptyState(project) : renderAgentEmptyState(project);
}

function buildContextOutput(
  project: string,
  observations: Observation[],
  summaries: SessionSummary[],
  config: ContextConfig,
  cwd: string,
  sessionId: string | undefined,
  forHuman: boolean
): string {
  const output: string[] = [];

  const economics = calculateTokenEconomics(observations);

  output.push(...renderHeader(project, economics, config, forHuman));

  const displaySummaries = summaries.slice(0, config.sessionCount);
  const summariesForTimeline = prepareSummariesForTimeline(displaySummaries, summaries);
  const timeline = buildTimeline(observations, summariesForTimeline);
  const fullObservationIds = getFullObservationIds(observations, config.fullObservationCount);

  output.push(...renderTimeline(timeline, fullObservationIds, config, cwd, forHuman));

  const mostRecentSummary = summaries[0];
  const mostRecentObservation = observations[0];

  if (shouldShowSummary(config, mostRecentSummary, mostRecentObservation)) {
    output.push(...renderSummaryFields(mostRecentSummary, forHuman));
  }

  const priorMessages = getPriorSessionMessages(observations, config, sessionId, cwd);
  output.push(...renderPreviouslySection(priorMessages, forHuman));

  output.push(...renderFooter(economics, config, forHuman));

  return output.join('\n').trimEnd();
}

/**
 * Telemetry-facing shape of one context injection. Counts, booleans, and our
 * own enum strings only — computed from the same observation set that was
 * rendered, never from user content.
 */
export interface ContextInjectStats {
  observation_count: number;
  session_count: number;
  timeline_depth_days: number;
  has_session_summary: boolean;
  obs_type_bugfix: number;
  obs_type_discovery: number;
  obs_type_decision: number;
  obs_type_refactor: number;
  obs_type_other: number;
  tokens_injected: number;
  tokens_saved_vs_naive: number;
  search_strategy: string;
}

const STAT_TYPE_BUCKETS = new Set(['bugfix', 'discovery', 'decision', 'refactor']);

function buildInjectStats(
  observations: Observation[],
  summaries: SessionSummary[],
  full: boolean
): ContextInjectStats {
  const economics = calculateTokenEconomics(observations);
  const typeCounts: Record<string, number> = {
    bugfix: 0, discovery: 0, decision: 0, refactor: 0, other: 0,
  };
  const sessionIds = new Set<string>();
  let oldestEpoch = Number.POSITIVE_INFINITY;
  for (const obs of observations) {
    const bucket = STAT_TYPE_BUCKETS.has(obs.type) ? obs.type : 'other';
    typeCounts[bucket]++;
    if (obs.memory_session_id) sessionIds.add(obs.memory_session_id);
    if (obs.created_at_epoch && obs.created_at_epoch < oldestEpoch) {
      oldestEpoch = obs.created_at_epoch;
    }
  }
  const timelineDepthDays = Number.isFinite(oldestEpoch)
    ? Math.max(0, Math.floor((Date.now() - oldestEpoch) / 86_400_000))
    : 0;

  return {
    observation_count: observations.length,
    session_count: sessionIds.size,
    timeline_depth_days: timelineDepthDays,
    has_session_summary: summaries.length > 0,
    obs_type_bugfix: typeCounts.bugfix,
    obs_type_discovery: typeCounts.discovery,
    obs_type_decision: typeCounts.decision,
    obs_type_refactor: typeCounts.refactor,
    obs_type_other: typeCounts.other,
    tokens_injected: economics.totalReadTokens,
    tokens_saved_vs_naive: economics.savings,
    search_strategy: full ? 'full' : 'timeline',
  };
}

/**
 * Paint every non-blank line, rather than wrapping the block once: session
 * context is long enough to scroll, and a single leading escape leaves the
 * warning uncolored wherever the terminal reflows or the reader scrolls back.
 */
function paintRed(text: string): string {
  return text
    .split('\n')
    .map((line) => (line.trim() ? `${colors.red}${line}${colors.reset}` : line))
    .join('\n');
}

/**
 * Append the observer-health outage warning when the observer is failing,
 * or the quota-cooldown pause notice when the breaker is withholding the
 * generator without a failure streak. Applied to EVERY context path
 * (including empty-state, missing-DB, and the no-memories-yet welcome hint
 * in SearchRoutes) so a multi-hour intentional pause is not silent.
 *
 * BELOW the context, not above it: the timeline runs long, so a warning at the
 * top has already scrolled off by the time the context finishes printing. The
 * last thing rendered is the thing still on screen — and for the model, the
 * closest thing to its first reply.
 */
export function withObserverHealthWarning(text: string, forHuman: boolean = false): string {
  return appendObserverHealthWarning(observerHealthWarning(forHuman), text);
}

/**
 * The warning on its own, or `''` when the observer is healthy.
 *
 * Split out so the fitted path can read the health ONCE and then measure the
 * warning as part of the block it is fitting. `fitContextToBudget` calls its
 * render repeatedly, and `readObserverHealth` touches state: re-reading it per
 * reduction would let the measured length change under the loop.
 */
export function observerHealthWarning(forHuman: boolean = false): string {
  const health = readObserverHealth();
  // Failure banner wins when both are set: the quota-exhausted copy already
  // says capture is paused, and a cooldown is not a second outage. Cooldown
  // alone (consecutiveFailures still below the unhealthy threshold) is the
  // gap this notice exists to close — the breaker withholds the generator
  // without ever incrementing the failure streak.
  let notice: string | null = null;
  if (isObserverUnhealthy(health)) {
    notice = renderObserverHealthWarning(health);
  } else if (isObserverQuotaCooldownActive(health)) {
    notice = renderObserverQuotaCooldownNotice(health);
  }
  if (!notice) {
    return '';
  }
  // Colors only on the human render: the agent copy is fetched separately
  // (colors=false) and ANSI escapes there are noise in the model's context.
  return forHuman ? paintRed(notice) : notice;
}

function appendObserverHealthWarning(warning: string, text: string): string {
  if (!warning) return text;
  return text ? `${text}\n\n${warning}` : warning;
}

/**
 * Fit the block to `limit` and report on exactly what survived.
 *
 * Split out of `generateContextWithStats` so both halves can be tested without
 * a database: the caller's only remaining job is to fetch rows. Two things have
 * to happen together here, and neither is safe on its own.
 *
 * The health warning is rendered INSIDE the measured block. Appending it to the
 * fitted result spends characters the fitter never counted, so an unhealthy
 * observer could push a block just fitted to 9,998 back over the limit — and
 * over the limit the whole block is replaced by the preview stub #3802 exists
 * to avoid, which is exactly when an outage warning most needs to arrive.
 *
 * The stats describe what was DELIVERED, not what was queried.
 * `ContextInjectStats` already promises this ("computed from the same
 * observation set that was rendered"); before this, a run trimmed from seven
 * observations to three still reported seven, so telemetry read as healthy
 * precisely when context was being dropped. `sessionCount` is the same slice
 * `buildContextOutput` takes for `displaySummaries`.
 */

//: THE SHARED STORE AS A ROW SOURCE -- deliberately here, and not in the hook.
//:
//: In `server` runtime every WRITE goes to the shared store while this READ opened
//: the per-machine SQLite file. Both halves already shipped and were never joined:
//: the client has carried contextObservations() -> POST /v1/context all along and
//: nothing called it. MEASURED 2026-09-17: the local corpus took 1 observation in
//: 24h against the store's 18,184.
//:
//: The FIRST attempt at this fix injected the route's pre-joined `context` string
//: straight into the hook's output, and that was wrong in a way worth recording: it
//: bypassed fitContextToBudget, so the block came back at 52,337 characters against
//: the CONTEXT_OUTPUT_LIMIT of 10,000 that #3802 exists to enforce -- and it lost
//: the header, the legend, the ids and the savings stats, 13,084 tokens where the
//: local block spent 1,787. Replacing the ROW SOURCE instead leaves the renderer,
//: the budget fitter, the token counter and the stats exactly as they were: the
//: only thing that changes is WHERE the rows came from.
//: The route's own ceiling, imported rather than copied. Held as a literal here
//: once, it silently became the real cap on the session-start preload: asking for
//: more than the route allowed was a ValidationError, so the block could never
//: grow past it however CLAUDE_MEM_CONTEXT_OBSERVATIONS was set.
const SERVER_CONTEXT_MAX_OBSERVATIONS = CONTEXT_LIMIT_MAX;

//: Session summaries live in the SAME store table as observations, told apart only
//: by `kind`. The observation list must exclude them or a summary lands in the list
//: reading as an ordinary memory; the summary section must ask for them alone or it
//: gets none -- 503 summaries against 347,146 observations on the hub, 2026-09-23.
const SUMMARY_KIND = 'summary';

//: Resolved once, for both the observation read and the summary read: two call
//: sites resolving the runtime separately can disagree about which store they are
//: talking to, and the failure would show as a block half from each.
async function resolveServerRuntime(): Promise<{ projectId: string; client: { contextObservations: (i: Record<string, unknown>) => Promise<{ observations?: unknown[] } | undefined> } } | null> {
  let runtime;
  try {
    const mod = await import('../hooks/runtime-selector.js');
    runtime = mod.resolveRuntimeContext();
  } catch (error) {
    logger.warn('HOOK', '[server] runtime unresolved for context', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
  if (runtime.runtime !== 'server') return null;
  return runtime as never;
}

/** Observations from the shared store, or null when it gave no answer. */
export async function fetchServerObservations(
  config: ContextConfig,
  project: string,
  platformSource: string | undefined
): Promise<Observation[] | null> {
  const runtime = await resolveServerRuntime();
  if (!runtime) return null;

  const want = Number(config.totalObservationCount) || 20;
  try {
    const result = await runtime.client.contextObservations({
      projectId: runtime.projectId,
      // NO `query` KEY. With one the route ranks by FTS; with the key absent it
      // returns the NEWEST, which is what a session-start block is. `query: ''`
      // is not a third option -- the route's schema rejects it (min 1 char).
      limit: Math.max(1, Math.min(SERVER_CONTEXT_MAX_OBSERVATIONS, want)),
      excludeKind: SUMMARY_KIND,
      ...(platformSource ? { platformSource } : {}),
    });
    //: NOT `rows.length === 0 -> null`. An empty answer from a store that HAS no
    //: rows yet is a legitimate first run; treating it as "no answer" makes an
    //: empty store indistinguishable from an unreachable one, and only one of
    //: those is a fault. A missing `observations` array IS no answer.
    if (!Array.isArray(result?.observations)) return null;
    return result.observations.map((r, i) => toLocalObservationShape(r as Record<string, unknown>, i, project, platformSource));
  } catch (error) {
    logger.warn('HOOK', '[server] observations unavailable from the shared store', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

//: The row shape mirrors the local SELECT field for field. `facts`, `concepts`,
//: `files_read` and `files_modified` are JSON *strings* in the local schema (the
//: writer calls JSON.stringify on each), so they are stringified here too -- handing
//: the renderer raw arrays would change what the token counter measures and silently
//: skew the savings stats. `kind` on the server carries the real observation type
//: (discovery, bugfix, change, feature, decision, ...), which is what `type` must be
//: for the emoji and the type histogram -- NOT the literal "observation".
export function toLocalObservationShape(
  r: Record<string, unknown>,
  index: number,
  project: string,
  platformSource: string | undefined
): Observation {
  const meta = (r.metadata ?? {}) as Record<string, unknown>;
  const pick = (...k: string[]): unknown => {
    for (const n of k) {
      if (r[n] !== undefined && r[n] !== null) return r[n];
      if (meta[n] !== undefined && meta[n] !== null) return meta[n];
    }
    return null;
  };
  const str = (v: unknown): string | null => (typeof v === 'string' ? v : v == null ? null : String(v));
  const json = (v: unknown): string | null => {
    if (v == null) return null;
    if (typeof v === 'string') return v;
    try { return JSON.stringify(v); } catch { return null; }
  };
  const epoch = Number(pick('createdAtEpoch', 'created_at_epoch')) || Date.now();
  const content = str(r.content) ?? '';
  const firstLine = content.split('\n', 1)[0] ?? '';
  return {
    id: index + 1,
    memory_session_id: str(pick('serverSessionId', 'memory_session_id')) ?? '',
    platform_source: platformSource ?? '',
    type: str(pick('kind', 'type')) ?? 'discovery',
    title: str(pick('title')) ?? firstLine,
    subtitle: str(pick('subtitle')),
    narrative: str(pick('narrative')) ?? (content || null),
    facts: json(pick('facts')),
    concepts: json(pick('concepts')),
    files_read: json(pick('files_read', 'filesRead')),
    files_modified: json(pick('files_modified', 'filesModified')),
    //: NULL, not 0. The shared store does not record it -- no `discovery_tokens`
    //: key exists in any of 347,146 rows' metadata, measured 2026-09-23. Zero would
    //: let the economics block print a savings percentage it never measured.
    discovery_tokens: null,
    created_at: new Date(epoch).toISOString(),
    created_at_epoch: epoch,
    project,
  };
}

//: Summaries, fetched on their own because only `kind` tells them apart. The hub
//: writes the five fields the local `session_summaries` table has as metadata keys
//: of the same names, so the mapping is field for field and lossless.
export async function fetchServerSummaries(
  config: ContextConfig,
  project: string,
  platformSource: string | undefined
): Promise<SessionSummary[] | null> {
  const runtime = await resolveServerRuntime();
  if (!runtime) return null;

  const want = Number(config.sessionCount) || 5;
  try {
    const result = await runtime.client.contextObservations({
      projectId: runtime.projectId,
      limit: Math.max(1, Math.min(SERVER_CONTEXT_MAX_OBSERVATIONS, want + 1)),
      kind: SUMMARY_KIND,
      ...(platformSource ? { platformSource } : {}),
    });
    if (!Array.isArray(result?.observations)) return null;
    return result.observations.map((r, i) => toLocalSummaryShape(r as Record<string, unknown>, i, project, platformSource));
  } catch (error) {
    logger.warn('HOOK', '[server] summaries unavailable from the shared store', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export function toLocalSummaryShape(
  r: Record<string, unknown>,
  index: number,
  project: string,
  platformSource: string | undefined
): SessionSummary {
  const meta = (r.metadata ?? {}) as Record<string, unknown>;
  const field = (...k: string[]): string | null => {
    for (const n of k) {
      const v = meta[n] ?? r[n];
      if (typeof v === 'string' && v.length > 0) return v;
    }
    return null;
  };
  const epoch = Number(r.createdAtEpoch ?? r.created_at_epoch) || Date.now();
  return {
    id: index + 1,
    memory_session_id: (typeof r.serverSessionId === 'string' ? r.serverSessionId : null) ?? '',
    platform_source: platformSource ?? '',
    request: field('request'),
    investigated: field('investigated'),
    learned: field('learned'),
    completed: field('completed'),
    next_steps: field('next_steps', 'nextSteps'),
    created_at: new Date(epoch).toISOString(),
    created_at_epoch: epoch,
    project,
  };
}

//: Whether this machine reads its memory from the shared store at all. Needed
//: separately from resolveServerRuntime(), which answers null both for "not server
//: runtime" and for "server runtime, could not resolve" -- and the whole point of
//: the rule below is that those two must not be treated alike.
export async function isServerRuntime(): Promise<boolean> {
  try {
    const mod = await import('../hooks/runtime-selector.js');
    return mod.resolveRuntimeContext().runtime === 'server';
  } catch {
    return false;
  }
}

//: THE RULE: in server runtime the block is built from the shared store or it is
//: built DEGRADED. It is never quietly built from the local corpus.
//:
//: The first cut of this fix did fall back, reasoning that a stale corpus beats no
//: memory. That is what hid the fault for five days: every write went to the hub
//: while the block came off a local mirror frozen at 2026-09-19T23:05Z, 128,104
//: rows against the hub's 347,146 -- and a silent fallback looks exactly like
//: health. The cost of the fallback is not a stale block; it is that nobody can
//: TELL it is stale.
//:
//: `null` from a fetcher means "no answer" (unreachable, malformed, wrong runtime).
//: `[]` means "asked, and the store has none" -- a legitimate first run, not a
//: fault, and not something to shout about.
export function serverRowsOrDegraded(
  serverObservations: Observation[] | null,
  serverSummaries: SessionSummary[] | null
): { observations: Observation[]; summaries: SessionSummary[]; degraded: string | null } {
  const missing: string[] = [];
  if (serverObservations === null) missing.push('observations');
  if (serverSummaries === null) missing.push('summaries');
  return {
    observations: serverObservations ?? [],
    summaries: serverSummaries ?? [],
    degraded: missing.length === 0
      ? null
      : `memory DEGRADED — the shared store did not answer for ${missing.join(' or ')}; `
        + 'this block is NOT your history and the local corpus was deliberately not '
        + 'substituted for it (it is a mirror, and a stale one is indistinguishable '
        + 'from a healthy block). Check the store before trusting what is below.',
  };
}

export function fitContextForDelivery(
  observations: Observation[],
  summaries: SessionSummary[],
  config: ContextConfig,
  healthWarning: string,
  renderBlock: (items: Observation[], cfg: ContextConfig) => string,
  limit: number,
  full: boolean
): { text: string; stats: ContextInjectStats } {
  const budget = fitContextToBudget(
    observations,
    config,
    (items, cfg) => appendObserverHealthWarning(healthWarning, renderBlock(items, cfg)),
    limit
  );

  if (budget.reductions > 0) {
    logger.debug('HOOK', 'Trimmed context to fit the hook output limit', {
      reductions: budget.reductions,
      observations: budget.observationCount,
      sessions: budget.config.sessionCount,
      chars: budget.text.length,
      overBudget: budget.overBudget,
    });
  }

  return {
    text: budget.text,
    stats: buildInjectStats(
      observations.slice(0, budget.observationCount),
      summaries.slice(0, budget.config.sessionCount),
      full
    ),
  };
}

export async function generateContextWithStats(
  input?: ContextInput,
  forHuman: boolean = false
): Promise<{ text: string; stats: ContextInjectStats | null }> {
  const config = loadContextConfig();
  const cwd = input?.cwd ?? process.cwd();
  const context = getProjectContext(cwd);

  const projects = input?.projects?.length ? input.projects : context.allProjects;
  const project = projects[projects.length - 1] ?? context.primary;

  if (input?.full) {
    config.totalObservationCount = 999999;
    config.sessionCount = 999999;
  }

  const rawDb = initializeDatabase();
  if (!rawDb) {
    return { text: withObserverHealthWarning('', forHuman), stats: null };
  }

  try {
    const db = { db: rawDb };
    const platformSource = input?.platformSource
      ? normalizePlatformSource(input.platformSource)
      : undefined;
    const queryProjects = projects.length > 1 ? projects : [project];
    // In SERVER runtime the shared store is the only source. The local SQLite file
    // is a mirror of it and is never substituted when the store is quiet -- see
    // serverRowsOrDegraded for why that fallback is the bug and not the safety net.
    // In worker runtime there IS no shared store and the local corpus is the truth.
    let observations: Observation[];
    let summaries: SessionSummary[];
    let degraded: string | null = null;
    if (await isServerRuntime()) {
      const [serverObservations, serverSummaries] = await Promise.all([
        fetchServerObservations(config, project, platformSource),
        fetchServerSummaries(config, project, platformSource),
      ]);
      const picked = serverRowsOrDegraded(serverObservations, serverSummaries);
      observations = picked.observations;
      summaries = picked.summaries;
      degraded = picked.degraded;
    } else {
      observations = queryObservationsMulti(db, queryProjects, config, platformSource);
      summaries = querySummariesMulti(db, queryProjects, config, platformSource);
    }

    if (observations.length === 0 && summaries.length === 0) {
      const empty = appendObserverHealthWarning(degraded ?? '', renderEmptyState(project, forHuman));
      return { text: withObserverHealthWarning(empty, forHuman), stats: null };
    }

    // `--full` is an explicit human request for everything; only the block that
    // has to survive a hook's 10,000-character delivery limit is fitted (#3802).
    return fitContextForDelivery(
      observations,
      summaries,
      config,
      appendObserverHealthWarning(degraded ?? '', observerHealthWarning(forHuman)),
      (items, cfg) =>
        buildContextOutput(project, items, summaries, cfg, cwd, input?.session_id, forHuman),
      input?.full ? Number.POSITIVE_INFINITY : CONTEXT_OUTPUT_LIMIT,
      Boolean(input?.full)
    );
  } finally {
    rawDb.close();
  }
}

export async function generateContext(
  input?: ContextInput,
  forHuman: boolean = false
): Promise<string> {
  return (await generateContextWithStats(input, forHuman)).text;
}
