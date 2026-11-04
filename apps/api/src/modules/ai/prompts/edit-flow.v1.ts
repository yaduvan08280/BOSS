import type { AiFlowDraft } from '@mono/shared';
import { system as buildSystem } from './build-flow.v1';
import type { CompanyContext } from './context';

/** Version 1, kept for the record. In use: edit-flow.v2.ts. */
export const id = 'edit_flow@1';

export function system(c: CompanyContext) {
  return `${buildSystem(c)}

You are now changing an existing process. Return the complete process with the requested change made.
Keep every step that the change does not touch exactly as it is, with the same key. New steps get new keys.
Leave "remember" empty.`;
}

export function user(current: AiFlowDraft, instruction: string) {
  return `The process now:\n${JSON.stringify(current)}\n\nChange:\n<instruction>\n${instruction}\n</instruction>`;
}
