import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { StatusChip } from '@/components/status-chip';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { ApiError, api } from '@/lib/api';

type Packs = {
  library: {
    key: string;
    name: string;
    industry: string;
    description: string;
    version: number;
    installed: number | null;
    upgrade: boolean;
  }[];
  installed: { key: string; name: string; version: number; things: number; shipped: boolean }[];
};
type Result = { name: string; made: unknown[]; kept: unknown[] };

/**
 * Master Library → Packs (phase 20): the set-up of a whole trade in one step. Install or upgrade one MONO ships,
 * install a file from another company, save this company's own set-up as a file, or take a pack off (what it
 * made stays).
 */
export function PacksCard({ canAdmin }: { canAdmin: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const file = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const q = useQuery({ queryKey: ['packs'], queryFn: () => api<Packs>('/api/packs') });
  const done = () => void qc.invalidateQueries();
  const fail = (e: unknown) => toast.error(e instanceof ApiError ? e.message : t('common.somethingWrong'));
  const said = (r: Result) =>
    toast.success(t('packs.installed', { name: r.name, made: r.made.length, kept: r.kept.length }));
  const install = useMutation({
    mutationFn: (key: string) => api<Result>(`/api/packs/library/${key}`, { method: 'POST', body: {} }),
    onSuccess: said,
    onError: fail,
    onSettled: done,
  });
  const fromFile = useMutation({
    mutationFn: (body: unknown) => api<Result>('/api/packs/install', { method: 'POST', body }),
    onSuccess: said,
    onError: fail,
    onSettled: done,
  });
  const remove = useMutation({
    mutationFn: (key: string) => api(`/api/packs/${key}`, { method: 'DELETE' }),
    onSuccess: () => toast.success(t('packs.removed')),
    onError: fail,
    onSettled: done,
  });
  const save = useMutation({
    mutationFn: () =>
      api<{ key: string }>('/api/packs/export', {
        method: 'POST',
        body: {
          key:
            name
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '_')
              .replace(/^[^a-z]+/, '')
              .slice(0, 40) || 'my_pack',
          name,
        },
      }),
    onSuccess: (pack) => {
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(pack, null, 2)], { type: 'application/json' }),
      );
      const a = Object.assign(document.createElement('a'), {
        href: url,
        download: `${pack.key}.mono-pack.json`,
      });
      a.click();
      URL.revokeObjectURL(url);
      toast.success(t('packs.saved'));
    },
    onError: fail,
  });
  if (!q.data) return null;
  const busy = install.isPending || fromFile.isPending || remove.isPending;
  return (
    <section className="space-y-3 rounded-card border bg-card p-4" data-testid="packs">
      <div>
        <h2 className="font-semibold">{t('packs.title')}</h2>
        <p className="text-sm text-muted-foreground">{t('packs.subtitle')}</p>
      </div>
      <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {q.data.library.map((p) => (
          <li
            key={p.key}
            className="flex flex-col gap-2 rounded-control border p-3"
            data-testid={`pack-${p.key}`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="font-medium">{p.name}</div>
              {p.installed != null && (
                <StatusChip tone={p.upgrade ? 'warn' : 'ok'}>
                  {p.upgrade
                    ? t('packs.newer', { version: p.version })
                    : t('packs.have', { version: p.installed })}
                </StatusChip>
              )}
            </div>
            <p className="flex-1 text-sm text-muted-foreground">{p.description}</p>
            {canAdmin && (p.installed == null || p.upgrade) && (
              <Button size="sm" disabled={busy} onClick={() => install.mutate(p.key)}>
                {p.upgrade ? t('packs.upgrade') : t('packs.install')}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {q.data.installed.length > 0 && (
        <ul className="space-y-1 border-t pt-3 text-sm">
          {q.data.installed.map((p) => (
            <li key={p.key} className="flex flex-wrap items-center justify-between gap-2">
              <span>
                {p.name} · v{p.version} · {t('packs.things', { count: p.things })}
              </span>
              {canAdmin && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  aria-label={t('packs.removeNamed', { name: p.name })}
                  onClick={() => {
                    if (window.confirm(t('packs.removeAsk', { name: p.name }))) remove.mutate(p.key);
                  }}
                >
                  {t('packs.remove')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canAdmin && (
        <div className="grid gap-3 border-t pt-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
          <Field label={t('packs.saveAs')}>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Button
            variant="secondary"
            disabled={name.trim().length < 2 || save.isPending}
            onClick={() => save.mutate()}
          >
            {t('packs.save')}
          </Button>
          <Button variant="secondary" disabled={busy} onClick={() => file.current?.click()}>
            {t('packs.fromFile')}
          </Button>
          <input
            ref={file}
            type="file"
            accept=".json,application/json"
            aria-label={t('packs.fromFile')}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              void f
                .text()
                .then((text) => fromFile.mutate(JSON.parse(text)))
                .catch(() => toast.error(t('packs.badFile')));
            }}
          />
        </div>
      )}
    </section>
  );
}
