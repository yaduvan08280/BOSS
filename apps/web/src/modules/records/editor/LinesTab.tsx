import { Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { RecordTable } from '@mono/shared';
import { Button } from '@/modules/records/ui';
import { Input } from '@/components/ui/input';
import { FieldsEditor } from '@/modules/fms/FieldsEditor';
import type { FormOwner } from '@/modules/fms/form/ctx';
import { keyFor } from '@/modules/fms/keys';
import type { TabProps } from './draft';
import { LinkAdder } from './LinkAdder';

/** Child lines: tables inside the record (items, visits, instalments), each with its own columns. */
export function LinesTab({ draft, set, owner, typeId }: TabProps & { owner?: FormOwner; typeId?: string }) {
  const { t } = useTranslation();
  const tables = draft.definition.tables;
  const save = (next: RecordTable[]) => set({ definition: { ...draft.definition, tables: next } });
  const patch = (i: number, p: Partial<RecordTable>) =>
    save(tables.map((x, j) => (j === i ? { ...x, ...p } : x)));
  return (
    <div className="max-w-4xl space-y-4">
      <p className="text-sm text-muted-foreground">{t('records.ed.linesHint')}</p>
      {tables.map((table, i) => (
        <section key={table.key} className="space-y-3 rounded-card border bg-card p-3 sm:p-4">
          <div className="flex items-center gap-2">
            <Input
              aria-label={t('records.ed.tableName')}
              placeholder={t('records.ed.tableName')}
              value={table.label}
              maxLength={60}
              onChange={(e) => patch(i, { label: e.target.value })}
            />
            <Button
              size="icon"
              variant="ghost"
              aria-label={t('records.ed.removeTable')}
              onClick={() => save(tables.filter((_, j) => j !== i))}
            >
              <Trash2 />
            </Button>
          </div>
          <FieldsEditor fields={table.fields} onChange={(fields) => patch(i, { fields })} owner={owner} />
          <LinkAdder
            typeId={typeId}
            fields={table.fields}
            onAdd={(field) => patch(i, { fields: [...table.fields, field] })}
          />
        </section>
      ))}
      <Button
        onClick={() => {
          const label = t('records.ed.newTable', { n: tables.length + 1 });
          const taken = [...tables.map((x) => x.key), ...draft.definition.fields.map((f) => f.key)];
          save([
            ...tables,
            {
              key: keyFor(label, taken),
              label,
              fields: [{ key: 'item', label: t('records.ed.firstColumn'), type: 'text', required: true }],
            },
          ]);
        }}
      >
        <Plus /> {t('records.ed.addTable')}
      </Button>
    </div>
  );
}
