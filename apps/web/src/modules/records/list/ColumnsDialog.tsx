import { ArrowDown, ArrowUp } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { listable, type RecordDefinition } from '@mono/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/form';
import { BUILTIN, columnLabel } from './columns';

const MAX = 12;

/** Choose which columns the list shows, and in which order. */
export function ColumnsDialog({
  def,
  columns,
  onSave,
  onClose,
}: {
  def: RecordDefinition;
  columns: string[];
  onSave: (columns: string[] | undefined) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [picked, setPicked] = useState(columns);
  const all = [...BUILTIN, ...def.fields.filter(listable).map((f) => f.key)];
  const off = all.filter((c) => !picked.includes(c));
  const move = (i: number, by: number) => {
    const next = [...picked];
    const [x] = next.splice(i, 1);
    next.splice(i + by, 0, x!);
    setPicked(next);
  };
  const row = (c: string, i: number | null) => (
    <li key={c} className="flex min-h-11 items-center gap-2 border-t px-3 first:border-t-0">
      <label className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-3 text-sm">
        <Checkbox
          checked={i !== null}
          disabled={i === null && picked.length >= MAX}
          onChange={(e) => setPicked(e.target.checked ? [...picked, c] : picked.filter((x) => x !== c))}
        />
        <span className="truncate">{columnLabel(def, c, t)}</span>
      </label>
      {i !== null && (
        <>
          <Button
            size="icon-sm"
            variant="ghost"
            disabled={i === 0}
            aria-label={t('chk.up')}
            onClick={() => move(i, -1)}
          >
            <ArrowUp />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            disabled={i === picked.length - 1}
            aria-label={t('chk.down')}
            onClick={() => move(i, 1)}
          >
            <ArrowDown />
          </Button>
        </>
      )}
    </li>
  );
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('records.list.columns')}
      description={t('records.list.columnsHint', { max: MAX })}
      footer={
        <>
          <Button variant="ghost" onClick={() => (onSave(undefined), onClose())}>
            {t('records.list.columnsReset')}
          </Button>
          <Button variant="primary" disabled={!picked.length} onClick={() => (onSave(picked), onClose())}>
            {t('records.list.apply')}
          </Button>
        </>
      }
    >
      <ul className="rounded-control border">
        {picked.map((c, i) => row(c, i))}
        {off.map((c) => row(c, null))}
      </ul>
    </Dialog>
  );
}
