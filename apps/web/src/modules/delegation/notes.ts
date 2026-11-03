import type { TaskDetail } from './api';

/** Event types that carry words someone wrote: they make up the conversation on a task. */
const SAID = ['note', 'follow_up', 'passed_on', 'comment'];

/** The notes thread: everything someone wrote on the task (notes, follow-ups, hand-overs, reasons). */
export const saidOf = (task: TaskDetail) => task.events.filter((e) => SAID.includes(e.type) && e.note);

/** Who worked on the task, in order: everyone who passed it on, then the doer now. */
export function chainOf(task: TaskDetail): string[] {
  const ids = task.events.filter((e) => e.type === 'passed_on' && e.fromUserId).map((e) => e.fromUserId!);
  return [...ids, task.doerId];
}
