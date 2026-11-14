import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Building2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { OrgPerson } from '@mono/shared';
import { Button } from '@/components/ui/button';
import { DateInput } from '@/components/ui/date-input';
import { Dialog } from '@/components/ui/dialog';
import { Field, Select } from '@/components/ui/form';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { post, put, useBranches, useOrgMutation, useUsers } from '../api';

type Places = {
  openWork: { tasks: number; steps: number; tickets: number; checklists: number; total: number };
  manager: { id: string; name: string } | null;
  homeBranchId: string | null;
  alsoBranchIds: string[];
  moves: { branchId: string | null; from: string | null; fromBranchId: string | null }[];
};
const formatDay = (day: string) => day.split('-').reverse().join('/');
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10);

/**
 * Where a person works: the home branch (changing it is a transfer, from a day), the other branches they also
 * work at, and their earlier moves. With several people it moves them all to one branch.
 */
export function BranchMoveDialog({
  people,
  toBranchId,
  onClose,
}: {
  people: OrgPerson[];
  /** The branch already chosen (a person dropped on a branch in the org chart). */
  toBranchId?: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const branches = useBranches().data ?? [];
  const one = people.length === 1 ? people[0]! : null;
  const [home, setHome] = useState(toBranchId ?? one?.branchId ?? '');
  const [also, setAlso] = useState<string[]>(one?.alsoBranchIds ?? []);
  const [from, setFrom] = useState(today());
  const [work, setWork] = useState<'keep' | 'handover' | 'manager'>('keep');
  const [taker, setTaker] = useState('');
  const everyone = useUsers().data ?? [];
  const places = useQuery({
    queryKey: ['org', 'places', one?.id],
    queryFn: () => api<Places>(`/api/branches/people/${one!.id}`),
    enabled: !!one,
  });
  const name = (id: string | null) => branches.find((b) => b.id === id)?.name ?? t('org.place.none');
  const moving = one ? home !== (one.branchId ?? '') : true;
  const open = places.data?.openWork;
  // One person with nothing open is not asked; several people always are.
  const askWork = moving && (one ? (open?.total ?? 0) > 0 : true);
  const workBody =
    askWork && work !== 'keep' ? { mode: work, toUserId: work === 'handover' ? taker : null } : null;
  const save = useOrgMutation(
    () =>
      one
        ? put(`/api/branches/people/${one.id}`, {
            homeBranchId: home || null,
            alsoBranchIds: also.filter((b) => b !== home),
            ...(home !== (one.branchId ?? '') && from !== today() ? { from } : {}),
            ...(workBody ? { work: workBody } : {}),
          })
        : post('/api/branches/people/move', {
            userIds: people.map((p) => p.id),
            homeBranchId: home || null,
            ...(from !== today() ? { from } : {}),
            ...(workBody ? { work: workBody } : {}),
          }),
    {
      success: one
        ? t('org.place.saved', { name: one.name })
        : t('org.place.savedMany', { count: people.length }),
    },
  );
  const movingIds = new Set(people.map((p) => p.id));
  const takers = everyone.filter((p) => p.status === 'ACTIVE' && !movingIds.has(p.id));

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={
        one ? t('org.place.title', { name: one.name }) : t('org.place.titleMany', { count: people.length })
      }
      description={t('org.place.hint')}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button
            variant="primary"
            disabled={save.isPending || (!one && !home) || (askWork && work === 'handover' && !taker)}
            onClick={() => save.mutate(undefined, { onSuccess: onClose })}
          >
            {moving && home ? t('org.place.move', { to: name(home) }) : t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4 pb-2">
        {one && (
          <div className="flex items-center gap-2 rounded-control bg-muted px-3 py-2 text-sm">
            <Building2 className="size-4 shrink-0 text-muted-foreground" />
            <span className="font-medium">{name(one.branchId)}</span>
            {moving && (
              <>
                <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                <span className="font-semibold">{name(home || null)}</span>
              </>
            )}
          </div>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t('org.place.home')}>
            <Select value={home} onChange={(e) => setHome(e.target.value)} aria-label={t('org.place.home')}>
              <option value="">{t('org.place.none')}</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </Field>
          {moving && (
            <Field label={t('org.place.from')}>
              <DateInput value={from} onChange={setFrom} aria-label={t('org.place.from')} />
            </Field>
          )}
        </div>
        {one && branches.length > 1 && (
          <Field label={t('org.place.also')}>
            <div className="flex flex-wrap gap-1.5">
              {branches
                .filter((b) => b.id !== home)
                .map((b) => {
                  const on = also.includes(b.id);
                  return (
                    <button
                      key={b.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setAlso(on ? also.filter((x) => x !== b.id) : [...also, b.id])}
                      className={cn(
                        'min-h-9 rounded-pill border px-3 text-xs font-medium',
                        on ? 'border-ink bg-ink text-ink-foreground' : 'bg-card text-muted-foreground',
                      )}
                    >
                      {b.name}
                    </button>
                  );
                })}
            </div>
          </Field>
        )}
        {askWork && (
          <fieldset className="space-y-2 rounded-control border p-3">
            <legend className="px-1 text-sm font-semibold">
              {one && open ? t('org.place.workTitle', { count: open.total }) : t('org.place.workTitleMany')}
            </legend>
            {one && open && (
              <p className="text-xs text-muted-foreground">
                {[
                  open.tasks && t('org.place.wTasks', { count: open.tasks }),
                  open.steps && t('org.place.wSteps', { count: open.steps }),
                  open.tickets && t('org.place.wTickets', { count: open.tickets }),
                  open.checklists && t('org.place.wChecklists', { count: open.checklists }),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            )}
            {(['keep', 'handover', 'manager'] as const).map((mode) => (
              <label key={mode} className="flex min-h-9 cursor-pointer items-start gap-2 text-sm">
                <input
                  type="radio"
                  name="work"
                  className="mt-1 size-4 accent-[var(--primary)]"
                  checked={work === mode}
                  onChange={() => setWork(mode)}
                />
                <span>
                  {t(`org.place.work.${mode}`, {
                    manager: places.data?.manager?.name ?? t('org.place.theManager'),
                  })}
                </span>
              </label>
            ))}
            {work === 'handover' && (
              <Select
                value={taker}
                onChange={(e) => setTaker(e.target.value)}
                aria-label={t('org.place.taker')}
              >
                <option value="">{t('org.place.taker')}</option>
                {takers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.branchName ? ` — ${p.branchName}` : ''}
                  </option>
                ))}
              </Select>
            )}
          </fieldset>
        )}
        <p className="text-xs text-muted-foreground">{t('org.place.note')}</p>
        {one && (places.data?.moves.length ?? 0) > 0 && (
          <div>
            <div className="mb-1.5 text-xs font-semibold text-muted-foreground">{t('org.place.history')}</div>
            <ul className="space-y-1 text-sm">
              {places.data!.moves.map((m, i) => (
                <li key={i} className="flex justify-between gap-3 border-b py-1.5 last:border-0">
                  <span>
                    {name(m.fromBranchId)} → <span className="font-medium">{name(m.branchId)}</span>
                  </span>
                  <span className="tabular shrink-0 text-muted-foreground">
                    {m.from ? formatDay(m.from) : t('org.place.always')}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Dialog>
  );
}
