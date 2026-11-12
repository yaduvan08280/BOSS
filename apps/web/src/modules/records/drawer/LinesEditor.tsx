import { Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { OrgPerson, RecordTable } from '@mono/shared';
import { Button } from '@/modules/records/ui';
import { FieldsForm } from '@/modules/fms/FieldsForm';
import type { FormOwner } from '@/modules/fms/form/ctx';
import type { Values } from '@/modules/fms/payload';

/** One table of child lines while editing: a card per line (the same on phones and wide screens), add and remove. */
export function LinesEditor({
  table,
  rows,
  onChange,
  errors = {},
  people,
  owner,
  known,
}: {
  table: RecordTable;
  rows: Values[];
  onChange: (rows: Values[]) => void;
  /** Problems by line number (from 1), then by column. */
  errors?: Record<number, Record<string, string>>;
  people: OrgPerson[];
  owner: FormOwner;
  known: Values;
}) {
  const { t } = useTranslation();
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">
          {table.label} <span className="font-normal text-muted-foreground">· {rows.length}</span>
        </h3>
        <Button size="sm" onClick={() => onChange([...rows, {}])}>
          <Plus /> {t('records.form.addLine')}
        </Button>
      </div>
      {rows.length === 0 && <p className="text-sm text-muted-foreground">{t('records.form.noLines')}</p>}
      {rows.map((row, i) => (
        <div key={i} className="rounded-control border bg-muted/30 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              {t('records.form.line', { n: i + 1 })}
            </span>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={t('records.form.removeLine', { n: i + 1 })}
              onClick={() => onChange(rows.filter((_, j) => j !== i))}
            >
              <Trash2 />
            </Button>
          </div>
          <FieldsForm
            fields={table.fields}
            values={row}
            onChange={(v) => onChange(rows.map((r, j) => (j === i ? v : r)))}
            errors={errors[i + 1]}
            people={people}
            owner={owner}
            known={known}
          />
        </div>
      ))}
    </section>
  );
}
