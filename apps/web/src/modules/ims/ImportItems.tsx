import { FileUp, Loader2 } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatINR, parseItemRows, splitTable } from '@mono/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/form';
import { imsApi, qty, useImsMutation, useItems } from './api';

const SAMPLE =
  'Code\tName\tUnit\tCategory\tLocation\tLead time\tRate\tMin\tMAX\tVendor\tOpening stock\nRM-001\tQuartz grit 0.3 mm\tkg\tRaw material\tYard A\t10\t42.50\t\t5000\tShree Minerals\t12000';

/** Item master + opening stock from Excel (.xlsx), CSV or a paste; checked line by line before anything is saved. */
export function ImportItems({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const items = useItems(true);
  const [table, setTable] = useState<string[][]>([]);
  const [text, setText] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const codes = useMemo(
    () => new Set((items.data?.items ?? []).map((i) => i.code.toLowerCase())),
    [items.data],
  );
  const rows = useMemo(() => parseItemRows(table, codes), [table, codes]);
  const ok = rows.length > 0 && rows.every((r) => !r.errors.length);
  const save = useImsMutation(
    () => imsApi.importItems(table),
    (r) => t('ims.i.imported', { count: r.created }),
  );
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (/\.xlsx$/i.test(f.name)) {
      const { readSheet } = await import('read-excel-file/browser');
      const sheet = await readSheet(f);
      setTable(
        sheet.map((r) => r.map((c) => (c instanceof Date ? c.toISOString().slice(0, 10) : String(c ?? '')))),
      );
    } else setTable(splitTable(await f.text()));
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={t('ims.i.import')}
      description={t('ims.i.importHint')}
      wide
      footer={
        <Button
          disabled={!ok || save.isPending}
          onClick={() => save.mutate(undefined, { onSuccess: () => (setTable([]), setText(''), onClose()) })}
        >
          {save.isPending && <Loader2 className="animate-spin" />}{' '}
          {t('ims.i.importN', { count: rows.length })}
        </Button>
      }
    >
      <div className="space-y-3">
        <Button variant="secondary" onClick={() => file.current?.click()}>
          <FileUp /> {t('task.openFile')}
        </Button>
        <input
          ref={file}
          type="file"
          accept=".csv,.tsv,.txt,.xlsx"
          className="hidden"
          onChange={(e) => void onFile(e.target.files?.[0])}
        />
        <Textarea
          rows={4}
          value={text}
          placeholder={SAMPLE}
          aria-label={t('ims.i.import')}
          onChange={(e) => (setText(e.target.value), setTable(splitTable(e.target.value)))}
        />
        {rows.length > 0 && (
          <div className="max-h-80 overflow-auto rounded-control border">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="sticky top-0 bg-muted text-left text-xs text-muted-foreground">
                <tr>
                  {[
                    '#',
                    t('ims.i.col.code'),
                    t('ims.i.col.name'),
                    t('ims.i.col.unit'),
                    t('ims.i.col.rate'),
                    t('ims.i.opening'),
                    '',
                  ].map((h, i) => (
                    <th key={i} className="px-2 py-1.5 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.line} className="border-t align-top">
                    <td className="px-2 py-1.5 text-muted-foreground">{r.line}</td>
                    <td className="px-2 py-1.5 font-mono text-xs">{r.code}</td>
                    <td className="px-2 py-1.5">{r.name}</td>
                    <td className="px-2 py-1.5">{r.unit}</td>
                    <td className="px-2 py-1.5 tabular-nums">{formatINR(r.ratePaise)}</td>
                    <td className="px-2 py-1.5 tabular-nums">{qty(r.openingQty)}</td>
                    <td className="px-2 py-1.5 text-status-bad-fg">{r.errors.join(' · ')}</td>
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
