import { CalendarOff, Check, Handshake, Loader2, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatLocalDate, localDate, type Me } from '@mono/shared';
import { EmptyState, ErrorState, PageSkeleton } from '@/components/page';
import { StatusChip } from '@/components/status-chip';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Select } from '@/components/ui/form';
import { personLabel } from '@/lib/people';
import { useUsers } from '@/modules/system/api';
import { hrApi, useBalances, useHrMutation, useLeaveLists, type LeaveRow } from './api';

const TONE = { PENDING: 'warn', APPROVED: 'ok', REJECTED: 'bad', CANCELLED: 'neutral' } as const;
const BTONE = {
  ASKED: 'warn',
  ACCEPTED: 'ok',
  DECLINED: 'bad',
  EXPIRED: 'bad',
  CANCELLED: 'neutral',
} as const;

function useNames() {
  const users = useUsers();
  return (id: string) => users.data?.find((u) => u.id === id)?.name ?? '?';
}

const dates = (l: { from: string; to: string; half?: string | null }, t: (k: string) => string) =>
  `${formatLocalDate(l.from)}${l.to !== l.from ? ` – ${formatLocalDate(l.to)}` : ''}${l.half ? ` · ${t(`hr.l.${l.half === 'FIRST' ? 'firstHalf' : 'secondHalf'}`)}` : ''}`;

/** One leave with its Buddies and what still has none. */
function LeaveCard({ l, me, decide }: { l: LeaveRow; me: Me; decide?: boolean }) {
  const { t } = useTranslation();
  const name = useNames();
  const users = useUsers();
  const [buddy, setBuddy] = useState('');
  const act = useHrMutation(
    (ok: boolean) => hrApi.decideLeave(l.id, ok),
    (r) => (r.withoutCover ? t('hr.l.approvedWithoutCover') : t('org.saved')),
  );
  const cancel = useHrMutation(
    () => hrApi.cancelLeave(l.id),
    () => t('hr.l.cancelled'),
  );
  const ask = useHrMutation(
    () =>
      hrApi.askBuddy(
        l.id,
        l.uncovered.map((u) => u.key),
        buddy,
      ),
    () => t('hr.l.asked'),
  );
  const live = l.status === 'PENDING' || l.status === 'APPROVED';
  return (
    <li className="space-y-2 rounded-card border bg-card p-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="font-semibold">
            {decide ? `${name(l.userId)} · ` : ''}
            {l.type} · {t('hr.l.days', { count: l.days })}
          </div>
          <div className="text-muted-foreground">
            {dates(l, t)} · {l.reason}
          </div>
        </div>
        <StatusChip tone={TONE[l.status]}>{t(`hr.lstatus.${l.status}`)}</StatusChip>
      </div>
      {l.buddies.length > 0 && (
        <ul className="space-y-1">
          {l.buddies.map((b) => (
            <li key={b.id} className="flex flex-wrap items-center gap-2">
              <StatusChip tone={BTONE[b.status]}>{t(`hr.bstatus.${b.status}`)}</StatusChip>
              <span>
                {name(b.buddyId)}: {b.items.map((i) => i.title).join(', ')}
              </span>
            </li>
          ))}
        </ul>
      )}
      {live && l.uncovered.length > 0 && (
        <div className="space-y-2 rounded-control bg-status-warn-bg p-3 text-status-warn-fg">
          <div>
            {t('hr.l.uncovered', { count: l.uncovered.length })}: {l.uncovered.map((u) => u.title).join(', ')}
          </div>
          <div className="flex flex-wrap gap-2">
            <Select
              value={buddy}
              aria-label={t('hr.l.askSomeone')}
              onChange={(e) => setBuddy(e.target.value)}
              className="min-w-56 bg-card text-foreground"
            >
              <option value="">{t('hr.l.askSomeone')}</option>
              {(users.data ?? [])
                .filter((u) => u.status === 'ACTIVE' && u.id !== l.userId)
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {personLabel(u)}
                  </option>
                ))}
            </Select>
            <Button size="sm" disabled={!buddy || ask.isPending} onClick={() => ask.mutate(undefined)}>
              {t('hr.l.ask')}
            </Button>
          </div>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {decide && l.status === 'PENDING' && (
          <>
            <Button size="sm" variant="primary" disabled={act.isPending} onClick={() => act.mutate(true)}>
              <Check /> {t('hr.l.approve')}
            </Button>
            <Button size="sm" variant="ghost" disabled={act.isPending} onClick={() => act.mutate(false)}>
              <X /> {t('hr.l.reject')}
            </Button>
          </>
        )}
        {!decide && l.userId === me.user.id && live && (
          <Button
            size="sm"
            variant="ghost"
            disabled={cancel.isPending}
            onClick={() => window.confirm(t('hr.l.confirmCancel')) && cancel.mutate(undefined)}
          >
            {t('hr.l.cancel')}
          </Button>
        )}
      </div>
    </li>
  );
}

export function MineTab({ me, today }: { me: Me; today: string }) {
  const { t } = useTranslation();
  const q = useLeaveLists();
  const b = useBalances(today);
  return (
    <div className="space-y-4">
      {b.data && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {b.data.balances
            .filter((x) => x.paid)
            .map((x) => (
              <Card key={x.leaveTypeId}>
                <CardContent className="pt-4">
                  <div className="text-xs text-muted-foreground">{x.name}</div>
                  <div className="text-2xl font-semibold tabular-nums">{x.available}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {t('hr.l.taken', { used: x.used, of: x.allotted + x.carried })}
                  </div>
                </CardContent>
              </Card>
            ))}
        </div>
      )}
      {q.isPending ? (
        <PageSkeleton />
      ) : q.isError ? (
        <ErrorState onRetry={() => void q.refetch()} />
      ) : !q.data.mine.length ? (
        <EmptyState icon={CalendarOff} title={t('hr.l.none')} />
      ) : (
        <ul className="space-y-2">
          {q.data.mine.map((l) => (
            <LeaveCard key={l.id} l={l} me={me} />
          ))}
        </ul>
      )}
    </div>
  );
}

export function ApproveTab({ me }: { me: Me }) {
  const { t } = useTranslation();
  const q = useLeaveLists();
  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  if (!q.data.toDecide.length) return <EmptyState icon={Check} title={t('hr.l.nothingToApprove')} />;
  return (
    <ul className="space-y-2">
      {q.data.toDecide.map((l) => (
        <LeaveCard key={l.id} l={l} me={me} decide />
      ))}
    </ul>
  );
}

/** Buddy requests sent to me: say yes or no. */
export function BuddyTab({ tz }: { tz: string }) {
  const { t } = useTranslation();
  const q = useLeaveLists();
  const name = useNames();
  const answer = useHrMutation(
    (x: { id: string; ok: boolean }) => hrApi.answerBuddy(x.id, x.ok),
    () => t('org.saved'),
  );
  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  if (!q.data.asks.length) return <EmptyState icon={Handshake} title={t('hr.l.noAsks')} />;
  return (
    <ul className="space-y-2">
      {q.data.asks.map((a) => (
        <li key={a.id} className="space-y-2 rounded-card border bg-card p-4 text-sm">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="font-semibold">{t('hr.l.coverFor', { name: name(a.userId) })}</div>
              <div className="text-muted-foreground">
                {formatLocalDate(localDate(new Date(a.from), tz))} –{' '}
                {formatLocalDate(localDate(new Date(new Date(a.to).getTime() - 60_000), tz))}
              </div>
            </div>
            <StatusChip tone={BTONE[a.status]}>{t(`hr.bstatus.${a.status}`)}</StatusChip>
          </div>
          <ul className="list-disc pl-5">
            {a.items.map((i) => (
              <li key={i.key}>{i.title}</li>
            ))}
          </ul>
          {a.status === 'ASKED' && (
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="primary"
                disabled={answer.isPending}
                onClick={() => answer.mutate({ id: a.id, ok: true })}
              >
                {answer.isPending ? <Loader2 className="animate-spin" /> : <Check />} {t('hr.l.yesCover')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={answer.isPending}
                onClick={() => answer.mutate({ id: a.id, ok: false })}
              >
                {t('hr.l.cant')}
              </Button>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
