import { useQuery } from '@tanstack/react-query';
import { FileText, Loader2, Plus, Settings2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { Me } from '@mono/shared';
import { EmptyState, PageHeader, PageSkeleton } from '@/components/page';
import { StatusChip } from '@/components/status-chip';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Textarea } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { TabStrip } from '@/components/work';
import { api } from '@/lib/api';
import { useWorkMutation } from '@/lib/work';
import { formatDate } from '@mono/shared';

type DocType = {
  id: string;
  code: string;
  name: string;
  prefix: string;
  header: string | null;
  footer: string | null;
  terms: string | null;
  active: boolean;
};
type Doc = {
  id: string;
  number: string;
  date: string;
  party: string | null;
  total: number | null;
  status: string;
  typeId: string;
  record: { id: string; number: number; flow: { name: string } } | null;
};

/** Documents (CLAUDE.md §6.2): every numbered paper the processes made, by type, with PDFs. */
export function DocumentsPage({ me }: { me: Me }) {
  const { t } = useTranslation();
  const [typeId, setTypeId] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Partial<DocType> | null>(null);
  const q = useQuery({
    queryKey: ['fms', 'documents', typeId, search],
    queryFn: () =>
      api<{ types: DocType[]; documents: Doc[] }>(
        `/api/documents?${new URLSearchParams({ ...(typeId !== 'all' ? { typeId } : {}), ...(search ? { q: search } : {}) })}`,
      ),
  });
  const types = q.data?.types ?? [];
  const tabs = ['all', ...types.map((x) => x.id)] as const;
  return (
    <div className="space-y-5">
      <PageHeader title={t('nav.documents')} subtitle={t('navDesc.documents')} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <TabStrip
          tabs={tabs}
          active={typeId}
          onChange={setTypeId}
          label={(k) => (k === 'all' ? t('fms.doc.all') : (types.find((x) => x.id === k)?.name ?? k))}
        />
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          <Input
            aria-label={t('fms.doc.search')}
            placeholder={t('fms.doc.search')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="min-w-0 flex-1 sm:w-56 sm:flex-none"
          />
          <Button onClick={() => setEditing({ active: true })}>
            <Plus /> {t('fms.doc.newType')}
          </Button>
        </div>
      </div>
      {types.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {types.map((x) => (
            <button
              key={x.id}
              onClick={() => setEditing(x)}
              className="inline-flex items-center gap-1.5 rounded-pill border bg-card px-3 py-1 text-xs hover:border-primary"
            >
              <Settings2 className="size-3.5" /> {x.name} ·{' '}
              <span className="font-mono">{x.prefix}/YY-YY/0001</span>
            </button>
          ))}
        </div>
      )}
      {q.isPending ? (
        <PageSkeleton />
      ) : !q.data?.documents.length ? (
        <EmptyState icon={FileText} title={t('fms.doc.none')} body={t('fms.doc.noneBody')} />
      ) : (
        <div className="overflow-x-auto rounded-card border bg-card">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                {['no', 'type', 'date', 'party', 'from', 'total', 'status'].map((h) => (
                  <th key={h} className="px-3 py-2.5 font-medium">
                    {t(`fms.doc.col.${h}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {q.data.documents.map((d) => (
                <tr key={d.id} className="hover:bg-muted/40">
                  <td className="px-3 py-2.5">
                    <a
                      className="font-mono font-semibold underline-offset-2 hover:underline"
                      href={`/api/documents/${d.id}/pdf`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {d.number}
                    </a>
                  </td>
                  <td className="px-3">{types.find((x) => x.id === d.typeId)?.name}</td>
                  <td className="tabular px-3">{formatDate(d.date, me.company.timezone)}</td>
                  <td className="px-3">{d.party ?? '—'}</td>
                  <td className="px-3 text-xs">
                    {d.record ? (
                      <Link
                        className="underline-offset-2 hover:underline"
                        to={`/fms/live?record=${d.record.id}`}
                      >
                        {d.record.flow.name} · #{d.record.number}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="tabular px-3">
                    {d.total !== null ? `₹${d.total.toLocaleString('en-IN')}` : '—'}
                  </td>
                  <td className="px-3">
                    <StatusChip tone={d.status === 'ISSUED' ? 'ok' : 'neutral'}>
                      {t(`fms.doc.st.${d.status}`)}
                    </StatusChip>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <DocTypeDialog value={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

/** Design & types: code, name, prefix, header, footer, terms. */
function DocTypeDialog({ value, onClose }: { value: Partial<DocType>; onClose: () => void }) {
  const { t } = useTranslation();
  const [d, setD] = useState<Partial<DocType>>(value);
  const save = useWorkMutation(
    () =>
      api('/api/document-types', {
        method: 'PUT',
        body: {
          code: d.code,
          name: d.name,
          prefix: d.prefix,
          header: d.header || null,
          footer: d.footer || null,
          terms: d.terms || null,
          active: d.active ?? true,
        },
      }),
    [['fms']],
    () => t('fms.b.saved'),
  );
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={value.id ? value.name : t('fms.doc.newType')}
      footer={
        <Button
          variant="primary"
          disabled={!d.code || !d.name || !d.prefix || save.isPending}
          onClick={() => save.mutate(undefined, { onSuccess: onClose })}
        >
          {save.isPending && <Loader2 className="animate-spin" />} {t('common.save')}
        </Button>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label={t('fms.doc.code')}>
          <Input
            disabled={Boolean(value.id)}
            value={d.code ?? ''}
            onChange={(e) => setD({ ...d, code: e.target.value.toUpperCase() })}
            placeholder="QUO"
          />
        </Field>
        <Field label={t('fms.doc.name')} className="sm:col-span-2">
          <Input
            value={d.name ?? ''}
            onChange={(e) => setD({ ...d, name: e.target.value })}
            placeholder={t('fms.doc.namePh')}
          />
        </Field>
        <Field label={t('fms.doc.prefix')} hint={`${d.prefix || 'QUO'}/26-27/0001`}>
          <Input
            value={d.prefix ?? ''}
            onChange={(e) => setD({ ...d, prefix: e.target.value.toUpperCase() })}
            placeholder="QUO"
          />
        </Field>
        <Field label={t('fms.doc.header')} className="sm:col-span-3">
          <Textarea
            className="font-sans"
            rows={2}
            value={d.header ?? ''}
            onChange={(e) => setD({ ...d, header: e.target.value })}
          />
        </Field>
        <Field label={t('fms.doc.terms')} className="sm:col-span-3">
          <Textarea
            className="font-sans"
            rows={3}
            value={d.terms ?? ''}
            onChange={(e) => setD({ ...d, terms: e.target.value })}
          />
        </Field>
        <Field label={t('fms.doc.footer')} className="sm:col-span-3">
          <Input value={d.footer ?? ''} onChange={(e) => setD({ ...d, footer: e.target.value })} />
        </Field>
      </div>
    </Dialog>
  );
}
