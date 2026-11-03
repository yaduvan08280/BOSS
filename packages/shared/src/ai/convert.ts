import { END, type FlowDefinition, type FlowField, type FlowStep } from '../fms/definition';
import { validateFlow, type FlowIssue } from '../fms/flow';
import type { AiField, AiFlowDraft, AiStep } from './drafts';

export type PersonRef = { id: string; name: string; designation?: string | null; department?: string | null };
export type Unmatched = { where: string; name: string };

const norm = (s: string) =>
  s
    .toLocaleLowerCase('en-IN')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\b(mr|mrs|ms|shri|smt|sir|ji|sahab|madam)\b\.?/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Find the person a name in plain words means: the full name, else a unique person whose name has all
 * the words ("Ravi" → Ravi Kumar when there is only one Ravi), else a unique designation ("store keeper").
 * Ambiguous or unknown → null, and the builder flags it for a person to choose.
 */
export function matchPerson(name: string, people: PersonRef[]): string | null {
  const q = norm(name);
  if (!q) return null;
  const exact = people.filter((p) => norm(p.name) === q);
  if (exact.length === 1) return exact[0]!.id;
  const words = q.split(' ');
  const byWords = people.filter((p) => {
    const have = norm(p.name).split(' ');
    return words.every((w) => have.some((h) => h === w || (w.length >= 3 && h.startsWith(w))));
  });
  if (byWords.length === 1) return byWords[0]!.id;
  if (byWords.length > 1) return null;
  const byRole = people.filter((p) => p.designation && norm(p.designation) === q);
  return byRole.length === 1 ? byRole[0]!.id : null;
}

/** "Confirm the order!" → "confirm_the_order" (a valid step / field key). */
export function slugKey(s: string): string {
  const k = norm(s)
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 36);
  return /^[a-z]/.test(k) ? k : `s_${k}`.slice(0, 36);
}

function uniqueKey(base: string, taken: Set<string>): string {
  let k = base || 'step';
  for (let i = 2; taken.has(k); i++) k = `${base.slice(0, 33)}_${i}`;
  taken.add(k);
  return k;
}

/** The AI's fields as form fields: unique keys, dropdowns only with choices. */
export function toFields(list: AiField[]): FlowField[] {
  const taken = new Set<string>();
  return list
    .filter((f) => f.label.trim())
    .slice(0, 40)
    .map((f) => {
      const choices = f.options
        .map((o) => o.trim())
        .filter(Boolean)
        .slice(0, 50);
      // A dropdown with nothing to choose from is just text.
      const type = (f.type === 'dropdown' || f.type === 'multiselect') && !choices.length ? 'text' : f.type;
      return {
        key: uniqueKey(slugKey(f.label), taken),
        label: f.label.trim().slice(0, 80),
        type,
        required: f.required,
        ...(type === 'dropdown' || type === 'multiselect' ? { options: choices } : {}),
      };
    });
}

export type DraftContext = {
  people: PersonRef[];
  departments: { id: string; name: string }[];
  documentTypes: { code: string; name: string }[];
};

export type ConvertedFlow = {
  meta: {
    name: string;
    runName: string;
    departmentIds: string[];
    coordinatorId: string | null;
    solverId: string | null;
  };
  definition: FlowDefinition;
  unmatched: Unmatched[];
  issues: FlowIssue[];
  summary: { steps: number; startFields: number; stepFields: number; unassigned: number };
};

/** Turn the AI's draft into a real flow: keys, people, departments, branches and document types. */
export function draftToFlow(draft: AiFlowDraft, ctx: DraftContext): ConvertedFlow {
  const unmatched: Unmatched[] = [];
  const person = (name: string | null, where: string) => {
    if (!name?.trim()) return null;
    const id = matchPerson(name, ctx.people);
    if (!id) unmatched.push({ where, name: name.trim() });
    return id;
  };

  // A step that only says "the end" is not a step: "end" already closes the record.
  const isEndMarker = (s: AiStep) =>
    /^(end|close|closed|finish|finished|done|stop)$/.test(slugKey(s.key || s.name)) &&
    !s.doers.length &&
    !s.byStarter &&
    !s.fields.length &&
    !s.autoText &&
    !s.documentType;
  // Step keys first, so branches can point at any step (by key or by name). "end" is reserved.
  const taken = new Set<string>([END]);
  const alias = new Map<string, string>();
  const steps = draft.steps.filter((s) => !isEndMarker(s)).slice(0, 60);
  const keys = steps.map((s) => {
    const k = uniqueKey(slugKey(s.key || s.name), taken);
    for (const a of [s.key, slugKey(s.key), s.name.toLowerCase(), slugKey(s.name)])
      if (a && !alias.has(a)) alias.set(a, k);
    return k;
  });
  const ref = (r: string | null) => {
    if (!r?.trim()) return undefined;
    if (/^(end|close|closed|finish|done|stop)$/i.test(r.trim())) return END;
    return alias.get(r) ?? alias.get(slugKey(r)) ?? alias.get(r.toLowerCase());
  };
  const docType = (s: AiStep) => {
    const want = (s.documentType ?? '').toLowerCase().trim();
    if (!want) return undefined;
    return ctx.documentTypes.find((d) => d.code.toLowerCase() === want || d.name.toLowerCase() === want)
      ?.code;
  };

  const out: FlowStep[] = steps.map((s, i) => {
    // A task with Yes/No routes is a decision in disguise; a "decision" with no routes at all is a task.
    const type =
      (s.type === 'TASK' || s.type === 'OUTSIDE') && (s.yes || s.no)
        ? 'DECISION'
        : s.type === 'DECISION' && !s.yes && !s.no
          ? 'TASK'
          : s.type;
    const following = keys[i + 1] ?? END;
    const doerIds = s.byStarter || type === 'AUTO' ? [] : s.doers.map((d) => person(d, s.name));
    const step: FlowStep = {
      key: keys[i]!,
      name: s.name.trim().slice(0, 100) || `Step ${i + 1}`,
      type,
      doerIds: [...new Set(doerIds.filter((x): x is string => Boolean(x)))],
      starter: s.byStarter && type !== 'AUTO',
      backupIds: [],
      checklist: s.checklist
        .map((c) => c.trim())
        .filter(Boolean)
        .slice(0, 30),
      fields: toFields(s.fields),
      documents: [],
      proofRequired: s.proofRequired,
      notifyCustomer: s.notifyCustomer,
    };
    if (s.time && type !== 'AUTO' && s.time.value >= 0)
      step.time = { value: Math.min(s.time.value, 10_000), unit: s.time.unit, anchor: s.time.from };
    if (type === 'DECISION') {
      // A missing Yes carries on to the following step; a missing No is left for a person to set.
      step.yes = ref(s.yes) ?? (s.yes ? undefined : following);
      step.no = ref(s.no);
    } else if (s.next) step.next = ref(s.next);
    if (type === 'APPROVAL') {
      // Some models write an approval's routes as Yes/No.
      const rejectTo = ref(s.rejectTo) ?? ref(s.no);
      if (rejectTo) step.rejectTo = rejectTo;
      const approved = ref(s.yes);
      if (!s.next && approved && approved !== following) step.next = approved;
    }
    if (type === 'AUTO') {
      const action = s.autoAction ?? (s.documentType ? 'document' : 'message');
      const code = action === 'document' ? docType(s) : undefined;
      if (action === 'document' && !code)
        unmatched.push({ where: s.name, name: s.documentType || 'document type' });
      step.auto = {
        action,
        ...(code ? { documentType: code } : {}),
        ...(action === 'message' && s.autoText ? { text: s.autoText.slice(0, 1000) } : {}),
      };
    }
    return step;
  });

  const definition: FlowDefinition = {
    startFields: toFields(draft.startFields),
    steps: out,
    timeModel: 'shifts',
  };
  const deptIds = draft.departments.flatMap((d) => {
    const n = d.toLowerCase().trim();
    const hit = ctx.departments.find((x) => x.name.toLowerCase() === n);
    if (!hit && n) unmatched.push({ where: 'department', name: d });
    return hit ? [hit.id] : [];
  });
  return {
    meta: {
      name: draft.name.trim().slice(0, 100) || 'New process',
      runName: draft.runName.trim().slice(0, 40) || 'Record',
      departmentIds: [...new Set(deptIds)],
      coordinatorId: person(draft.coordinator, 'coordinator'),
      solverId: person(draft.solver, 'solver'),
    },
    definition,
    unmatched,
    issues: validateFlow(definition),
    summary: {
      steps: out.length,
      startFields: definition.startFields.length,
      stepFields: out.reduce((n, s) => n + s.fields.length, 0),
      unassigned: out.filter((s) => s.type !== 'AUTO' && !s.starter && !s.doerIds.length).length,
    },
  };
}

/** A saved flow in the AI's own words (names, not ids), for "Edit with AI". */
export function flowToDraft(
  def: FlowDefinition,
  meta: {
    name: string;
    runName: string;
    coordinatorId?: string | null;
    solverId?: string | null;
    departments: string[];
  },
  names: Map<string, string>,
): AiFlowDraft {
  const field = (f: FlowField): AiField => ({
    label: f.label,
    type: f.type,
    required: f.required,
    options: f.options ?? [],
  });
  return {
    name: meta.name,
    runName: meta.runName,
    departments: meta.departments,
    coordinator: meta.coordinatorId ? (names.get(meta.coordinatorId) ?? null) : null,
    solver: meta.solverId ? (names.get(meta.solverId) ?? null) : null,
    startFields: def.startFields.map(field),
    remember: [],
    steps: def.steps.map((s) => ({
      key: s.key,
      name: s.name,
      type: s.type,
      doers: s.doerIds.map((id) => names.get(id) ?? id),
      byStarter: s.starter,
      time:
        s.time && (s.time.anchor === 'previous' || s.time.anchor === 'start')
          ? { value: s.time.value, unit: s.time.unit, from: s.time.anchor }
          : null,
      fields: s.fields.map(field),
      checklist: s.checklist,
      proofRequired: s.proofRequired,
      yes: s.yes ?? null,
      no: s.no ?? null,
      next: s.next ?? null,
      rejectTo: s.rejectTo ?? null,
      autoAction: s.auto && s.auto.action !== 'stock' ? s.auto.action : null,
      documentType: s.auto?.documentType ?? null,
      autoText: s.auto?.text ?? null,
      notifyCustomer: s.notifyCustomer,
    })),
  };
}

export type FlowDiff = {
  added: { key: string; name: string }[];
  removed: { key: string; name: string }[];
  changed: { key: string; name: string; what: string[] }[];
  startFieldsAdded: string[];
  startFieldsRemoved: string[];
};

/** What "Edit with AI" would change, step by step, for the person to accept or reject. */
export function flowDiff(before: FlowDefinition, after: FlowDefinition): FlowDiff {
  const old = new Map(before.steps.map((s) => [s.key, s]));
  const now = new Map(after.steps.map((s) => [s.key, s]));
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  const changed: FlowDiff['changed'] = [];
  for (const s of after.steps) {
    const o = old.get(s.key);
    if (!o) continue;
    const what: string[] = [];
    if (o.name !== s.name) what.push('name');
    if (o.type !== s.type) what.push('type');
    if (!same([...o.doerIds].sort(), [...s.doerIds].sort()) || o.starter !== s.starter) what.push('doers');
    if (!same(o.time, s.time)) what.push('time');
    if (
      !same(
        o.fields.map((f) => [f.label, f.type, f.required]),
        s.fields.map((f) => [f.label, f.type, f.required]),
      )
    )
      what.push('fields');
    if (!same(o.checklist, s.checklist)) what.push('checklist');
    if (o.proofRequired !== s.proofRequired) what.push('proof');
    if (!same([o.yes, o.no, o.next, o.rejectTo], [s.yes, s.no, s.next, s.rejectTo])) what.push('route');
    if (!same(o.auto, s.auto) || o.notifyCustomer !== s.notifyCustomer) what.push('automatic');
    if (what.length) changed.push({ key: s.key, name: s.name, what });
  }
  const labels = (d: FlowDefinition) => new Set(d.startFields.map((f) => f.label));
  const [lb, la] = [labels(before), labels(after)];
  return {
    added: after.steps.filter((s) => !old.has(s.key)).map((s) => ({ key: s.key, name: s.name })),
    removed: before.steps.filter((s) => !now.has(s.key)).map((s) => ({ key: s.key, name: s.name })),
    changed,
    startFieldsAdded: [...la].filter((l) => !lb.has(l)),
    startFieldsRemoved: [...lb].filter((l) => !la.has(l)),
  };
}

export const diffIsEmpty = (d: FlowDiff) =>
  !d.added.length &&
  !d.removed.length &&
  !d.changed.length &&
  !d.startFieldsAdded.length &&
  !d.startFieldsRemoved.length;
