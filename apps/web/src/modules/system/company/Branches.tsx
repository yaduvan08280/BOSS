import { GitFork, MapPin, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { INDIAN_STATES } from '@mono/shared';
import { EmptyState, ErrorState, PageSkeleton } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Badge, Checkbox, Field, Select } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { del, patch, post, useBranches, useOrgMutation, type Branch } from '../api';

type Draft = {
  id?: string;
  name: string;
  code: string;
  parentId: string;
  city: string;
  state: string;
  isDefault: boolean;
};
const NEW: Draft = { name: '', code: '', parentId: '', city: '', state: '', isDefault: false };

function descendants(all: Branch[], id: string): Set<string> {
  const out = new Set<string>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const b of all) {
      if (b.parentId && out.has(b.parentId) && !out.has(b.id)) {
        out.add(b.id);
        grew = true;
      }
    }
  }
  return out;
}

export function Branches() {
  const { t } = useTranslation();
  const q = useBranches();
  const [draft, setDraft] = useState<Draft | null>(null);
  const save = useOrgMutation(
    ({ id, ...b }: Draft) => {
      const body = {
        ...b,
        parentId: b.parentId || null,
        code: b.code || null,
        city: b.city || null,
        state: b.state || null,
      };
      return id ? patch(`/api/org/branches/${id}`, body) : post('/api/org/branches', body);
    },
    { success: t('org.saved') },
  );
  const remove = useOrgMutation((id: string) => del(`/api/org/branches/${id}`), {
    success: t('org.deleted'),
  });

  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} error={q.error} />;
  const all = q.data;

  const node = (b: Branch, depth: number): React.ReactNode => (
    <li
      key={b.id}
      className={
        depth
          ? 'relative pl-6 before:absolute before:left-2 before:top-0 before:h-7 before:w-3 before:rounded-bl-lg before:border-b before:border-l'
          : ''
      }
    >
      <Card className="flex items-center gap-3 p-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-control bg-accent-soft text-accent-soft-foreground">
          <MapPin className="size-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 font-medium">
            {b.name}
            {b.code && <span className="font-mono text-xs text-muted-foreground">{b.code}</span>}
            {b.isDefault && (
              <Badge className="bg-accent-soft text-accent-soft-foreground">{t('org.default')}</Badge>
            )}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {[b.city, b.state].filter(Boolean).join(', ') || '—'} ·{' '}
            {t('org.peopleCount', { count: b.people })}
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('org.edit')}
          onClick={() =>
            setDraft({
              id: b.id,
              name: b.name,
              code: b.code ?? '',
              parentId: b.parentId ?? '',
              city: b.city ?? '',
              state: b.state ?? '',
              isDefault: b.isDefault,
            })
          }
        >
          <Pencil />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('org.delete')}
          onClick={() => remove.mutate(b.id)}
        >
          <Trash2 />
        </Button>
      </Card>
      {all.some((c) => c.parentId === b.id) && (
        <ul className="mt-2 space-y-2">
          {all.filter((c) => c.parentId === b.id).map((c) => node(c, depth + 1))}
        </ul>
      )}
    </li>
  );

  const blocked = draft?.id ? descendants(all, draft.id) : new Set<string>();
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button variant="primary" onClick={() => setDraft(NEW)}>
          <Plus /> {t('org.branches.add')}
        </Button>
      </div>
      {all.length === 0 ? (
        <EmptyState icon={GitFork} title={t('org.branches.emptyTitle')} body={t('org.branches.emptyBody')} />
      ) : (
        <ul className="max-w-3xl space-y-2">
          {all.filter((b) => !b.parentId || !all.some((p) => p.id === b.parentId)).map((b) => node(b, 0))}
        </ul>
      )}
      <Dialog
        open={!!draft}
        onOpenChange={(o) => !o && setDraft(null)}
        title={draft?.id ? t('org.branches.edit') : t('org.branches.add')}
        footer={
          <Button
            variant="primary"
            disabled={!draft?.name || save.isPending}
            onClick={() => draft && save.mutate(draft, { onSuccess: () => setDraft(null) })}
          >
            {t('common.save')}
          </Button>
        }
      >
        {draft && (
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('org.branches.parent')} className="col-span-2">
              <Select
                value={draft.parentId}
                onChange={(e) => setDraft({ ...draft, parentId: e.target.value })}
              >
                <option value="">{t('org.branches.noParent')}</option>
                {all
                  .filter((b) => !blocked.has(b.id))
                  .map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label={t('org.name')} className="col-span-2 sm:col-span-1">
              <Input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder={t('org.branches.namePh')}
                autoFocus
              />
            </Field>
            <Field label={t('org.branches.code')} className="col-span-2 sm:col-span-1">
              <Input
                value={draft.code}
                onChange={(e) => setDraft({ ...draft, code: e.target.value.toUpperCase() })}
                className="font-mono"
                placeholder="KSG"
              />
            </Field>
            <Field label={t('org.company.city')}>
              <Input value={draft.city} onChange={(e) => setDraft({ ...draft, city: e.target.value })} />
            </Field>
            <Field label={t('org.company.state')}>
              <Select value={draft.state} onChange={(e) => setDraft({ ...draft, state: e.target.value })}>
                <option value="">{t('org.choose')}</option>
                {INDIAN_STATES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </Select>
            </Field>
            <label className="col-span-2 flex items-center gap-2 text-sm">
              <Checkbox
                checked={draft.isDefault}
                onChange={(e) => setDraft({ ...draft, isDefault: e.target.checked })}
              />
              {t('org.branches.default')}
            </label>
          </div>
        )}
      </Dialog>
    </div>
  );
}
