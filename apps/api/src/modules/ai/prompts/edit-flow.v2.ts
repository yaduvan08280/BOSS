import type { AiFlowDraft } from '@mono/shared';
import { system as buildSystem } from './build-flow.v2';
import type { CompanyContext } from './context';

/** "Edit with AI" on a saved flow: the whole flow comes back with the change made. */
export const id = 'edit_flow@2';

export function system(c: CompanyContext) {
  return `${buildSystem(c)}

You are now changing an existing process. Return the complete process with the requested change made.
Keep every step that the change does not touch exactly as it is, with the same key. New steps get new keys.
Leave "remember" empty.`;
}

export function user(current: AiFlowDraft, instruction: string) {
  return `The process now:\n${JSON.stringify(current)}\n\nChange:\n<instruction>\n${instruction}\n</instruction>`;
}
