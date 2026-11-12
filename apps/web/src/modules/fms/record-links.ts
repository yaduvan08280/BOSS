import { mergeData, refsOf } from '@mono/shared';
import { useLinks } from '@/modules/masters/api';
import type { RecordDetail } from './api';

/** Every link kept on a record (its start form and its steps), resolved in one call. */
export function useRecordLinks(r: RecordDetail | undefined) {
  const refs = r ? [r.data, ...r.steps.map((s) => s.data)].flatMap((d) => Object.values(refsOf(d))) : [];
  return useLinks(refs).data;
}

/** What a step's form already knows: the start form and every finished step, oldest first (links included). */
export function knownOf(r: RecordDetail) {
  const done = r.steps
    .filter((s) => s.status === 'DONE')
    .sort((a, b) => String(a.doneAt).localeCompare(String(b.doneAt)));
  return mergeData(r.data, ...done.map((s) => s.data));
}
