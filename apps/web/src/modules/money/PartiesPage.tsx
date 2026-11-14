import { Pencil, Plus, ScrollText, Users } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatLocalDate, hasPermission, INDIAN_STATES, type Me } from '@mono/shared';
import { EmptyState, ErrorState, PageHeader, PageSkeleton } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Badge, Field, Select } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { money, useMoneyMutation, useParties, useStatement, type Party } from './api';

const PARTY_KINDS = [
  'customer',
  'dealer',
  'vendor',
  'guest',
  'company',
  'agent',
  'franchise',
  'transporter',
  'member',
] as const;

/** Everyone the company deals with, in one list: customers, vendors, guests, agents … */
export function PartiesPage({ me }: { me: Me }) {
  const { t } = useTranslation();
  const [kind, setKind] = useState('');
  const [search, setSearch] = useState('');
  const [edit, setEdit] = useState<Partial<Party> | null>(null);
  const [statementOf, setStatementOf] = useState<Party | null>(null);
  const q = useParties(kind || undefined);
  const canEdit = hasPermission(me.user.permissions, 'money.edit');
  const rows = (q.data ?? []).filter((p) => {
    const s = search.trim().toLowerCase();
    return !s || `${p.name} ${p.code} ${p.mobile ?? ''}`.toLowerCase().includes(s);
  });
  return (
    <div>
      <PageHeader
        title={t('money.parties.title')}
        subtitle={t('money.parties.subtitle')}
        actions={
          canEdit && (
            <Button variant="primary" onClick={() => setEdit({ kinds: ['customer'] })}>
              <Plus /> {t('money.parties.add')}
            </Button>
          )
        }
      />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Select
          aria-label={t('money.parties.kind')}
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          className="w-44"
        >
          <option value="">{t('money.parties.allKinds')}</option>
          {PARTY_KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`money.partyKind.${k}`)}
            </option>
          ))}
        </Select>
        <Input
          aria-label={t('money.parties.search')}
          placeholder={t('money.parties.search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="sm:w-64"
        />
      </div>
      {q.isPending ? (
        <PageSkeleton />
      ) : q.isError ? (
        <ErrorState onRetry={() => void q.refetch()} error={q.error} />
      ) : rows.length === 0 ? (
        <EmptyState icon={Users} title={t('money.parties.emptyTitle')} body={t('money.parties.emptyBody')} />
      ) : (
        <ul className="grid grid-cols-1 gap-2 lg:grid-cols-2">
          {rows.map((p) => (
            <li key={p.id}>
              <Card className="flex items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 font-medium">
                    <span className="truncate">{p.name}</span>
                    <span className="font-mono text-xs text-muted-foreground">{p.code}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {p.kinds.map((k) => (
                      <Badge key={k}>{t(`money.partyKind.${k}`)}</Badge>
                    ))}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {[p.mobile, p.state, p.taxId].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('money.statement')}
                  title={t('money.statement')}
                  onClick={() => setStatementOf(p)}
                >
                  <ScrollText />
                </Button>
                {canEdit && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('org.edit')}
                    onClick={() => setEdit(p)}
                  >
                    <Pencil />
                  </Button>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
      {edit && <PartyDialog party={edit} onClose={() => setEdit(null)} />}
      {statementOf && <StatementDialog party={statementOf} onClose={() => setStatementOf(null)} />}
    </div>
  );
}

function PartyDialog({ party, onClose }: { party: Partial<Party>; onClose: () => void }) {
  const { t } = useTranslation();
  const [d, setD] = useState({
    name: party.name ?? '',
    kinds: party.kinds ?? ['customer'],
    mobile: party.mobile ?? '',
    email: party.email ?? '',
    taxId: party.taxId ?? '',
    state: party.state ?? '',
    address: party.address ?? '',
    creditDays: String(party.creditDays ?? 0),
  });
  const save = useMoneyMutation(
    () =>
      api(party.id ? `/api/money/parties/${party.id}` : '/api/money/parties', {
        method: party.id ? 'PUT' : 'POST',
        body: { ...d, creditDays: Number(d.creditDays) || 0 },
      }),
    t('org.saved'),
  );
  const toggle = (k: string) =>
    setD({ ...d, kinds: d.kinds.includes(k) ? d.kinds.filter((x) => x !== k) : [...d.kinds, k] });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={party.id ? party.name : t('money.parties.add')}
      footer={
        <Button
          variant="primary"
          disabled={d.name.trim().length < 2 || !d.kinds.length || save.isPending}
          onClick={() => save.mutate(undefined, { onSuccess: onClose })}
        >
          {t('common.save')}
        </Button>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('org.name')} className="col-span-2">
          <Input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} autoFocus />
        </Field>
        <div className="col-span-2">
          <div className="mb-1.5 text-sm font-medium">{t('money.parties.kinds')}</div>
          <div className="flex flex-wrap gap-1.5">
            {PARTY_KINDS.map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={d.kinds.includes(k)}
                onClick={() => toggle(k)}
                className={cn(
                  'h-9 rounded-pill border px-3 text-sm',
                  d.kinds.includes(k)
                    ? 'border-transparent bg-accent-soft text-accent-soft-foreground'
                    : 'bg-card text-muted-foreground',
                )}
              >
                {t(`money.partyKind.${k}`)}
              </button>
            ))}
          </div>
        </div>
        <Field label={t('org.company.mobile')} className="col-span-2 sm:col-span-1">
          <Input inputMode="tel" value={d.mobile} onChange={(e) => setD({ ...d, mobile: e.target.value })} />
        </Field>
        <Field label={t('money.parties.taxId')} className="col-span-2 sm:col-span-1">
          <Input
            className="font-mono"
            value={d.taxId}
            onChange={(e) => setD({ ...d, taxId: e.target.value.toUpperCase() })}
          />
        </Field>
        <Field
          label={t('org.company.state')}
          hint={t('money.parties.stateHint')}
          className="col-span-2 sm:col-span-1"
        >
          <Select value={d.state} onChange={(e) => setD({ ...d, state: e.target.value })}>
            <option value="">{t('org.choose')}</option>
            {[...new Set([...INDIAN_STATES, ...(d.state ? [d.state] : [])])].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </Select>
        </Field>
        <Field label={t('money.parties.creditDays')} className="col-span-2 sm:col-span-1">
          <Input
            inputMode="numeric"
            value={d.creditDays}
            onChange={(e) => setD({ ...d, creditDays: e.target.value })}
          />
        </Field>
        <Field label={t('branches.address')} className="col-span-2">
          <Input value={d.address} onChange={(e) => setD({ ...d, address: e.target.value })} />
        </Field>
      </div>
    </Dialog>
  );
}

/** Every issued paper of a party in order, with the running balance. */
function StatementDialog({ party, onClose }: { party: Party; onClose: () => void }) {
  const { t } = useTranslation();
  const q = useStatement(party.id);
  return (
    <Dialog
      open
      wide
      onOpenChange={(o) => !o && onClose()}
      title={t('money.statementOf', { name: party.name })}
    >
      {q.isPending ? (
        <div className="h-32 animate-pulse rounded-control bg-muted" />
      ) : q.isError ? (
        <ErrorState onRetry={() => void q.refetch()} error={q.error} />
      ) : q.data.lines.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('money.noPapers')}</p>
      ) : (
        <div className="space-y-2 text-sm">
          <ul className="divide-y rounded-control border">
            {q.data.lines.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-x-3 px-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="font-mono text-xs">{l.number}</span>
                  <span className="block text-xs text-muted-foreground">
                    {t(`money.kind.${l.type}`)} · {formatLocalDate(l.date)}
                  </span>
                </span>
                <span className={cn('tabular', l.credit > 0 && 'text-status-ok-fg')}>
                  {l.debit > 0 ? money(l.debit) : `− ${money(l.credit)}`}
                </span>
                <span className="tabular w-28 text-right text-xs text-muted-foreground">
                  {money(l.balance)}
                </span>
              </li>
            ))}
          </ul>
          <div className="flex justify-between font-semibold">
            <span>{q.data.closing >= 0 ? t('money.theyOwe') : t('money.weOwe')}</span>
            <span className="tabular">{money(Math.abs(q.data.closing))}</span>
          </div>
        </div>
      )}
    </Dialog>
  );
}
