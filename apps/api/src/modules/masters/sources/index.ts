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
  /**
   * Dependent choices: only rows whose `column` equals `value` (or, when both sides are links, whose link is
   * `ref`). Applied by `masterOptions` after the handler, so a handler need not look at it.
   */
  filter?: { column: string; value: string; ref?: string };
  /** `rec:` sources: which records to offer. */
  rec?: { step?: string; running?: boolean; mine?: boolean; days?: number };
  /**
   * Only the rows with these ids (ignore `q`). This is how a picked link is checked when a form is saved and
   * how its columns are read, so every handler that returns `ref` must honour it.
   */
  ids?: string[];
};

/** A source of choices. `arg` is what follows the prefix (`m:<arg>`, `fms:<arg>`, `rec:<arg>` …). */
export type SourceHandler = (
  db: Db,
  actor: Actor,
  arg: string,
  query: OptionQuery,
) => Promise<MasterOption[]>;

/** A column a source's rows carry (for the editor's auto-fill and "depends on" pickers). */
export type SourceColumn = { key: string; label: string };
