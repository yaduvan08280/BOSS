import { describe, expect, it } from 'vitest';
import { checkAskPlan, type AskPlan } from './ask';
import { diffIsEmpty, draftToFlow, flowDiff, flowToDraft, matchPerson, slugKey } from './convert';
import type { AiFlowDraft, AiStep } from './drafts';
import { costMicros, detailsQuality, wordCount } from './providers';

const people = [
  { id: 'u1', name: 'Ravi Kumar', designation: 'Store Keeper' },
  { id: 'u2', name: 'Ravi Shankar Meena', designation: 'Sales Executive' },
  { id: 'u3', name: 'Neha Kapoor', designation: 'Marketing Manager' },
  { id: 'u4', name: 'Arjun Rawat', designation: 'Sales Executive' },
  { id: 'u5', name: 'Sunita Sharma', designation: 'Accountant' },
];

describe('matching names to people', () => {
  it('finds full names, unique first names and unique designations', () => {
    expect(matchPerson('Neha Kapoor', people)).toBe('u3');
    expect(matchPerson('neha', people)).toBe('u3');
    expect(matchPerson('Mr. Arjun', people)).toBe('u4');
    expect(matchPerson('Sunita ji', people)).toBe('u5');
    expect(matchPerson('Accountant', people)).toBe('u5');
    expect(matchPerson('store keeper', people)).toBe('u1');
  });
  it('leaves ambiguous or unknown names for a person to choose', () => {
    expect(matchPerson('Ravi', people)).toBeNull(); // two Ravis
    expect(matchPerson('Ravi Kumar', people)).toBe('u1');
    expect(matchPerson('Sales Executive', people)).toBeNull(); // two of them
    expect(matchPerson('Mahesh', people)).toBeNull();
    expect(matchPerson('', people)).toBeNull();
  });
  it('makes valid keys from any words', () => {
    expect(slugKey('Confirm the order!')).toBe('confirm_the_order');
    expect(slugKey('2nd follow-up')).toMatch(/^s_2nd_follow_up$/);
    expect(slugKey('ग्राहक')).toMatch(/^[a-z]/);
  });
});

const step = (s: Partial<AiStep> & Pick<AiStep, 'key' | 'name'>): AiStep => ({
  type: 'TASK',
  doers: [],
  byStarter: false,
  time: { value: 4, unit: 'hours', from: 'previous' },
  fields: [],
  checklist: [],
  proofRequired: false,
  yes: null,
  no: null,
  next: null,
  rejectTo: null,
  autoAction: null,
  documentType: null,
  autoText: null,
  notifyCustomer: false,
  ...s,
});

const draft: AiFlowDraft = {
  name: 'Lead to Order',
  runName: 'Lead',
  departments: ['Sales', 'Moon Base'],
  coordinator: 'Neha',
  solver: 'Mahesh',
  startFields: [
    { label: 'Company name', type: 'text', required: true, options: [] },
    { label: 'Source', type: 'dropdown', required: true, options: ['Website', 'IndiaMART'] },
    { label: 'Budget', type: 'dropdown', required: false, options: [] },
  ],
  steps: [
    step({ key: 'capture', name: 'Capture the lead', byStarter: true }),
    step({ key: 'qualify', name: 'Qualify', doers: ['Arjun'] }),
    step({
      key: 'need',
      name: 'Need confirmed?',
      type: 'DECISION',
      doers: ['Arjun'],
      yes: 'Send quote',
      no: 'end',
    }),
    step({
      key: 'quote',
      name: 'Send quote',
      doers: ['Ravi'],
      fields: [{ label: 'Quote amount', type: 'amount', required: true, options: [] }],
    }),
    step({
      key: 'approve',
      name: 'Manager approval',
      type: 'APPROVAL',
      doers: ['Neha Kapoor'],
      rejectTo: 'quote',
    }),
    step({
      key: 'invoice',
      name: 'Make proforma',
      type: 'AUTO',
      autoAction: 'document',
      documentType: 'pi',
      time: null,
    }),
  ],
  remember: ['Leads come mostly from IndiaMART'],
};
const ctx = {
  people,
  departments: [{ id: 'd1', name: 'Sales' }],
  documentTypes: [{ code: 'PI', name: 'Proforma invoice' }],
};

describe('turning an AI draft into a flow', () => {
  const out = draftToFlow(draft, ctx);
  it('maps people, departments, branches and document types', () => {
    expect(out.meta).toMatchObject({
      name: 'Lead to Order',
      runName: 'Lead',
      departmentIds: ['d1'],
      coordinatorId: 'u3',
      solverId: null,
    });
    const [capture, qualify, need, quote, approve, auto] = out.definition.steps;
    expect(capture).toMatchObject({ starter: true, doerIds: [] });
    expect(qualify!.doerIds).toEqual(['u4']);
    expect(need).toMatchObject({ yes: 'quote', no: 'end' });
    expect(quote!.doerIds).toEqual([]); // "Ravi" is ambiguous
    expect(quote!.fields[0]).toMatchObject({ key: 'quote_amount', type: 'amount', required: true });
    expect(approve).toMatchObject({ doerIds: ['u3'], rejectTo: 'quote' });
    expect(auto).toMatchObject({ type: 'AUTO', auto: { action: 'document', documentType: 'PI' } });
    expect(auto!.time).toBeUndefined();
  });
  it('flags what a person must still choose', () => {
    expect(out.unmatched).toEqual(
      expect.arrayContaining([
        { where: 'Send quote', name: 'Ravi' },
        { where: 'solver', name: 'Mahesh' },
        { where: 'department', name: 'Moon Base' },
      ]),
    );
    expect(out.summary).toEqual({ steps: 6, startFields: 3, stepFields: 1, unassigned: 1 });
    expect(out.issues.map((i) => i.code)).toEqual(['noDoer']);
  });
  it('fixes common slips: an "End" step, routes on a task, an approval written as Yes/No, a decision without routes', () => {
    const slips = draftToFlow(
      {
        ...draft,
        steps: [
          step({ key: 'a', name: 'Check stock', no: 'buy' }),
          step({ key: 'buy', name: 'Buy', doers: ['Arjun'] }),
          step({
            key: 'ok',
            name: 'Approve',
            type: 'APPROVAL',
            doers: ['Neha Kapoor'],
            yes: 'pack',
            no: 'buy',
          }),
          step({ key: 'nego', name: 'Negotiate', type: 'DECISION', doers: ['Arjun'] }),
          step({ key: 'pack', name: 'Pack', doers: ['Arjun'] }),
          step({ key: 'end', name: 'End', type: 'AUTO', time: null }),
        ],
      },
      ctx,
    );
    const [a, , ok, nego] = slips.definition.steps;
    expect(slips.definition.steps.map((s) => s.key)).toEqual(['a', 'buy', 'ok', 'nego', 'pack']);
    expect(a).toMatchObject({ type: 'DECISION', yes: 'buy', no: 'buy' });
    expect(ok).toMatchObject({ type: 'APPROVAL', rejectTo: 'buy', next: 'pack' });
    expect(nego!.type).toBe('TASK');
  });
  it('makes a dropdown without choices a text box', () => {
    expect(out.definition.startFields.map((f) => f.type)).toEqual(['text', 'dropdown', 'text']);
  });
  it('round-trips through the AI shape with the same keys (for Edit with AI)', () => {
    const names = new Map(people.map((p) => [p.id, p.name]));
    const back = draftToFlow(
      flowToDraft(out.definition, { ...out.meta, departments: ['Sales'] }, names),
      ctx,
    );
    expect(back.definition.steps.map((s) => s.key)).toEqual(out.definition.steps.map((s) => s.key));
    expect(diffIsEmpty(flowDiff(out.definition, back.definition))).toBe(true);
  });
  it('lists what an edit would change', () => {
    const edited = JSON.parse(JSON.stringify(out.definition)) as typeof out.definition;
    edited.steps.splice(3, 0, {
      ...edited.steps[1]!,
      key: 'site_visit',
      name: 'Site visit',
    });
    edited.steps[1]!.time = { value: 2, unit: 'days', anchor: 'previous' };
    edited.steps.pop();
    edited.startFields.push({ key: 'city', label: 'City', type: 'text', required: false });
    expect(flowDiff(out.definition, edited)).toEqual({
      added: [{ key: 'site_visit', name: 'Site visit' }],
      removed: [{ key: 'invoice', name: 'Make proforma' }],
      changed: [{ key: 'qualify', name: 'Qualify', what: ['time'] }],
      startFieldsAdded: ['City'],
      startFieldsRemoved: [],
    });
  });
});

describe('Ask plans', () => {
  const plan = (p: Partial<AskPlan>): AskPlan => ({
    answerable: true,
    why: '',
    view: 'tasks',
    columns: [],
    filters: [],
    groupBy: null,
    aggregate: null,
    orderBy: null,
    limit: 50,
    ...p,
  });
  it('accepts names from the catalog only', () => {
    expect(
      checkAskPlan(
        plan({
          filters: [{ column: 'is_late', op: 'eq', value: true }],
          groupBy: 'doer',
          aggregate: { fn: 'count', column: null },
          orderBy: { column: 'value', dir: 'desc' },
        }),
      ),
    ).toEqual([]);
    expect(checkAskPlan(plan({ columns: ['password_hash'] }))).toEqual(['Unknown column "password_hash"']);
    expect(
      checkAskPlan(plan({ filters: [{ column: 'doer; drop table users', op: 'eq', value: 'x' }] }))[0],
    ).toMatch(/Unknown filter column/);
    expect(checkAskPlan(plan({ groupBy: 'planned_at' }))).toEqual(['Group only by a text column']);
    expect(checkAskPlan(plan({ aggregate: { fn: 'sum', column: 'doer' } }))).toEqual([
      "Can't sum a text column",
    ]);
    expect(checkAskPlan(plan({ filters: [{ column: 'status', op: 'in', value: 'OPEN' }] }))).toEqual([
      'Filter "in" on "status" needs a list',
    ]);
  });
});

describe('costs and the business details meter', () => {
  it('estimates cost per model and lets settings price the others', () => {
    expect(costMicros('anthropic', 'claude-opus-5-5', 1_000, 500)).toBe(14_000); // $0.014
    expect(costMicros('anthropic', 'claude-haiku-5-5', 10_000, 1_000)).toBe(1_500);
    expect(costMicros('openai', 'some-model', 1_000, 1_000)).toBe(0);
    expect(costMicros('openai', 'some-model', 1_000, 1_000, { in: 1, out: 2 })).toBe(3_000);
    expect(costMicros('ollama', 'qwen2.5:7b', 1_000_000, 1_000_000)).toBe(0);
  });
  it('rates how much the AI has to go on', () => {
    expect(wordCount('  We make quartz slabs \n in Kishangarh ')).toBe(6);
    expect([0, 20, 120, 300, 521].map(detailsQuality)).toEqual([
      'empty',
      'short',
      'fair',
      'good',
      'veryGood',
    ]);
  });
});
