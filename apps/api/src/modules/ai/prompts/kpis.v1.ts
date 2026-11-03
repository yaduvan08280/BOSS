import type { FlowDefinition } from '@mono/shared';
import { aboutCompany, type CompanyContext } from './context';

/** "Suggest with AI" on the Dashboard tab: KPI cards from the flow's own fields. */
export const id = 'kpis@1';

export function system(c: CompanyContext) {
  return `You suggest dashboard number cards for a business process in MONO.
A card counts records or adds up a number field over a period and is compared with the period before.
source: "count" (number of records started), "start:<field key>" (a start form field) or
"step:<step key>:<field key>" (a field filled at a step). Only number and amount fields can be TOTAL,
AVERAGE, MIN or MAX; anything else is COUNT. Suggest 3 to 6 cards that an owner would look at every
day or week, each with a short label and one line on why it matters.

${aboutCompany(c)}`;
}

export function user(flow: { name: string; runName: string; definition: FlowDefinition }) {
  const fields = [
    ...flow.definition.startFields.map((f) => `start:${f.key} — ${f.label} (${f.type})`),
    ...flow.definition.steps.flatMap((s) =>
      s.fields.map((f) => `step:${s.key}:${f.key} — ${s.name}: ${f.label} (${f.type})`),
    ),
  ];
  return `Process: ${flow.name} (each run is a ${flow.runName}).\nSteps: ${flow.definition.steps
    .map((s) => s.name)
    .join(' → ')}\nFields:\n${fields.join('\n') || '(none)'}`;
}
