// SPDX-License-Identifier: Apache-2.0
//
// Org overlay: name the machine that wrote a row. Several workstations write
// into one shared store; without this header attribution stops at the person.
//
//   X-Claude-Mem-Writing-Machine: <pinned machine id>
//
// Value: $CLAUDE_MEM_WRITING_MACHINE, else <$CLAUDE_POLICY_CONFIG or
// ~/.config/claude-policy>/machine-id (the id the fleet issued, never hostname).
// FAIL-OPEN: a missing, unreadable or malformed id sends no header and throws
// nothing, so a session never fails to start because attribution is unavailable.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const WRITING_MACHINE_HEADER = 'X-Claude-Mem-Writing-Machine';
const VALID = /^[A-Za-z0-9._@:+-]{1,128}$/;

export function writingMachineHeaders(): Record<string, string> {
  try {
    const dir = process.env.CLAUDE_POLICY_CONFIG || join(homedir(), '.config', 'claude-policy');
    const id = String(process.env.CLAUDE_MEM_WRITING_MACHINE || readFileSync(join(dir, 'machine-id'), 'utf8')).trim();
    return VALID.test(id) ? { [WRITING_MACHINE_HEADER]: id } : {};
  } catch {
    return {};
  }
}
