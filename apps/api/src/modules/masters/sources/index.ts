import type { Db } from '@mono/db';
import type { Actor } from '../../work/actor';

/**
 * One choice of a "from a master" field. `value` is the text kept in the record; `ref` links it to the row it
 * came from (`customer:<id>`, `item:<id>`, `row:<id>`, `rec:<id>` … see `makeRef`); `columns` are the row's other
 * values, for auto-fill (`fill`) and dependent choices (`filterBy`).
 */
export type MasterOption = {
  value: string;
  label: string;
  sub: string | null;
  ref?: string;
  columns?: Record<string, unknown>;
};

export type OptionQuery = {
  q: string;
  limit: number;
  /** Dependent choices: only rows whose `column` equals `value`. */
  filter?: { column: string; value: string };
  /** `rec:` sources: which records to offer. */
  rec?: { step?: string; running?: boolean; mine?: boolean; days?: number };
};

/** A source of choices. `arg` is what follows the prefix (`m:<arg>`, `fms:<arg>`, `rec:<arg>` …). */
export type SourceHandler = (
  db: Db,
  actor: Actor,
  arg: string,
  query: OptionQuery,
) => Promise<MasterOption[]>;
