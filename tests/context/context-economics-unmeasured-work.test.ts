import { describe, expect, it } from 'bun:test';

import { renderAgentContextEconomics } from '../../src/services/context/formatters/AgentFormatter.js';
import { renderHumanContextEconomics } from '../../src/services/context/formatters/HumanFormatter.js';

/**
 * "Work investment" is the sum of every row's `discovery_tokens`. The SHARED store
 * does not record that column -- MEASURED 2026-09-23, no `discovery_tokens` key
 * exists in the metadata of any of its 347,146 rows -- so a block built from the
 * store sums to zero.
 *
 * Zero is not a measurement of zero. Printing "0 tokens spent on research" states
 * that no work was done, which is the opposite of true, and it is the line the
 * operator reads first. An unmeasured quantity is omitted, not rendered as 0.
 */

const economics = (discovery: number) => ({
  totalObservations: 50,
  totalReadTokens: 24_965,
  totalDiscoveryTokens: discovery,
  savings: discovery - 24_965,
  savingsPercent: discovery > 0 ? 50 : 0,
});

const config = { showReadTokens: true, showWorkTokens: true, showSavingsAmount: false, showSavingsPercent: true } as never;

describe('unmeasured work investment is omitted, never printed as zero', () => {
  it('agent block drops the work part when nothing recorded it', () => {
    const line = renderAgentContextEconomics(economics(0) as never, config).join('\n');
    expect(line).toContain('50 obs');
    expect(line).not.toContain('0t work');
  });

  it('agent block still reports work when it WAS recorded', () => {
    const line = renderAgentContextEconomics(economics(4_369_747) as never, config).join('\n');
    expect(line).toContain('4,369,747t work');
  });

  it('human block drops the work line when nothing recorded it', () => {
    const text = renderHumanContextEconomics(economics(0) as never, config).join('\n');
    expect(text).toContain('Loading: 50 observations');
    expect(text).not.toContain('Work investment');
  });

  it('human block still reports work when it WAS recorded', () => {
    const text = renderHumanContextEconomics(economics(4_369_747) as never, config).join('\n');
    expect(text).toContain('Work investment: 4,369,747');
  });
});
