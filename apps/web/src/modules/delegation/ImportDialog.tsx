import { FileUp, Loader2 } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { parseTaskRows, splitTable, zonedToUtc, type OrgPerson } from '@mono/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/form';
import { api } from '@/lib/api';
import { formatShortDateTime } from '@/lib/when';
import { useTaskMutation } from './api';

/** Import many: paste rows or open a CSV/Excel file; everything is checked before anything is created. */
export function ImportDialog({
  open,
  onClose,
  people,
  tz,
}: {
  open: boolean;
  onClose: () => void;
  people: OrgPerson[];
  tz: string;
}) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<string[][]>([]);
  const [text, setText] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const parsed = useMemo(
    () =>
      parseTaskRows(
        rows,
        people.map((p) => ({ id: p.id, code: p.code, name: p.name, mobile: p.mobile })),
        (d, m) => zonedToUtc(d, m, tz).toISOString(),
      ),
    [rows, people, tz],
  );
  const ok = parsed.length > 0 && parsed.every((r) => !r.errors.length);
  const save = useTaskMutation(
    () =>
      api<{ created: number }>('/api/tasks/import', {
        method: 'POST',
        body: {
          tasks: parsed.map((r) => ({
            doerId: r.doerId,
            plannedAt: r.plannedAt,
            description: r.description,
            verifierId: r.verifierId,
            requireProof: r.requireProof,
          })),
        },
      }),
    (r) => t('task.imported', { count: r.created }),
  );

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (/\.xlsx$/i.test(f.name)) {
      const { readSheet } = await import('read-excel-file/browser');
      const sheet = await readSheet(f);
      setRows(
        sheet.map((r) =>
          r.map((c) =>
            c instanceof Date
              ? `${c.getDate()}/${c.getMonth() + 1}/${c.getFullYear()} ${c.getHours()}:${String(c.getMinutes()).padStart(2, '0')}`
              : String(c ?? ''),
          ),
        ),
      );
    } else {
      setRows(splitTable(await f.text()));
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={t('task.importMany')}
      description={t('task.importHint')}
      wide
      footer={
        <Button
          variant="primary"
          disabled={!ok || save.isPending}
          onClick={() => save.mutate(undefined, { onSuccess: () => (setRows([]), setText(''), onClose()) })}
        >
          {save.isPending && <Loader2 className="animate-spin" />}{' '}
          {t('task.importN', { count: parsed.length })}
        </Button>
      }
    >
      <div className="space-y-3">
        <div className="flex gap-2">
          <Button onClick={() => file.current?.click()}>
            <FileUp /> {t('task.openFile')}
          </Button>
          <input
            ref={file}
            type="file"
            accept=".csv,.tsv,.txt,.xlsx"
            className="hidden"
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
        </div>
        <Textarea
          rows={4}
          value={text}
          onChange={(e) => (setText(e.target.value), setRows(splitTable(e.target.value)))}
          placeholder={
            'Doer\tDue\tTask\tVerifier\nSandeep Pal\t05/11/2026 18:00\tCalibrate press 2 gauges\tAjay Meena'
          }
          aria-label={t('task.importMany')}
        />
        {parsed.length > 0 && (
          <div className="overflow-x-auto rounded-control border">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
                <tr>
                  {[
                    '#',
                    t('task.doer'),
                    t('task.col.planned'),
                    t('task.description'),
                    t('task.verifier'),
                  ].map((h) => (
                    <th key={h} className="px-3 py-2 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {parsed.map((r) => (
                  <tr key={r.line} className={r.errors.length ? 'bg-status-bad-bg/40' : undefined}>
                    <td className="tabular px-3 py-2 text-muted-foreground">{r.line}</td>
                    <td className="px-3 py-2">
                      {r.doerLabel || '—'}
                      {r.errors.map((e) => (
                        <div key={e} className="text-xs text-status-bad-fg">
                          {e}
                        </div>
                      ))}
                    </td>
                    <td className="tabular px-3 py-2">
                      {r.plannedAt ? formatShortDateTime(r.plannedAt, tz) : '—'}
                    </td>
                    <td className="max-w-xs truncate px-3 py-2">{r.description || '—'}</td>
                    <td className="px-3 py-2">{r.verifierLabel || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Dialog>
  );
}
