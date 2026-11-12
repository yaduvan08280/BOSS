import type { Db, Tx } from '@mono/db';
import { checkFields, REFS_KEY, refsOf, type FlowField, type Refs } from '@mono/shared';
import { AppError } from '../../lib/errors';
import { itemLinesStage } from '../ims/item-lines';
import { formulaStage } from './formula';
import { learnStage } from './learn';
import { linkStage } from './links';
import { reportStage } from './report';
import { uniqueStage } from './unique';

/** Where a form lives. Value lists and "unique" checks are kept per owner. */
export type FormOwner = { kind: 'flow' | 'master' | 'recordType'; id: string };

export type FormScope = {
  companyId: string;
  /** null = the public form or the system. */
  actorId: string | null;
  owner: FormOwner;
  /**
   * The record / row being changed, so "unique" does not trip over itself. For a new record pass the id it will
   * be created with (`createId()`): unique values are claimed for that id while the form is saved.
   */
  recordId?: string;
  /** Values already on the record (the start form and earlier steps): formulas and dependent choices read them. */
  known?: Record<string, unknown>;
  publicForm?: boolean;
  /** May add to a "remember what people type" list that is closed to new values (admins). */
  canAddValues?: boolean;
};

/** What the stages work on: `values` are the cleaned values, `refs` the links of picked rows (see links.ts in shared). */
export type FormState = {
  input: Record<string, unknown>;
  values: Record<string, unknown>;
  refs: Refs;
  errors: Record<string, string>;
};

/**
 * One concern of a form (links, value lists, formulas, unique values). `check` may fix values and add errors;
 * `commit` runs only when the whole form is valid and is about to be saved (same transaction).
 */
export type FormStage = {
  name: string;
  check?: (db: Db | Tx, scope: FormScope, fields: FlowField[], state: FormState) => Promise<void>;
  commit?: (tx: Tx, scope: FormScope, fields: FlowField[], state: FormState) => Promise<void>;
  /** The record is cancelled or deleted: give back what it held (its unique values). */
  release?: (tx: Tx, target: FormTarget) => Promise<void>;
};

/** A record that is going away: an FMS record, a master row, a record of a record type. */
export type FormTarget = { companyId: string; owner: FormOwner; recordId: string };

/**
 * Order matters: links settle what was picked, lists check typed text, formulas use both, unique sees the final
 * values, and the reportable copies are written from what is finally stored.
 */
const STAGES: FormStage[] = [linkStage, itemLinesStage, learnStage, formulaStage, uniqueStage, reportStage];

/** Check a form: the basic field rules (shared `checkFields`), then every stage. Nothing is written. */
export async function checkForm(
  db: Db | Tx,
  scope: FormScope,
  fields: FlowField[],
  input: Record<string, unknown>,
): Promise<FormState> {
  const { values, errors } = checkFields(fields, input);
  const keys = new Set(fields.map((f) => f.key));
  const refs = Object.fromEntries(Object.entries(refsOf(input)).filter(([k]) => keys.has(k) && k in values));
  const state: FormState = { input, values, refs, errors };
  for (const stage of STAGES) await stage.check?.(db, scope, fields, state);
  return state;
}

/** After a valid `checkForm`, inside the transaction that saves the record: let the stages record what they need. */
export async function commitForm(tx: Tx, scope: FormScope, fields: FlowField[], state: FormState) {
  for (const stage of STAGES) await stage.commit?.(tx, scope, fields, state);
}

/** The values to store: cleaned values plus the links of picked rows. */
export function storedValues(state: FormState): Record<string, unknown> {
  const refs = Object.fromEntries(Object.entries(state.refs).filter(([k]) => k in state.values));
  return Object.keys(refs).length ? { ...state.values, [REFS_KEY]: refs } : { ...state.values };
}

/** Check, refuse with the first problem (and all of them by field), commit, and hand back what to store. */
export async function processForm(
  tx: Tx,
  scope: FormScope,
  fields: FlowField[],
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const state = await checkForm(tx, scope, fields, input);
  if (Object.keys(state.errors).length)
    throw new AppError(400, 'VALIDATION_FAILED', Object.values(state.errors)[0]!, { fields: state.errors });
  await commitForm(tx, scope, fields, state);
  return storedValues(state);
}

/** Call when a record is cancelled or deleted, in the same transaction, so its unique values can be used again. */
export async function releaseForm(tx: Tx, target: FormTarget) {
  for (const stage of STAGES) await stage.release?.(tx, target);
}
