import { ArrowRight, Check, Funnel, Loader2, Plus, Trophy, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { addDays, formatLocalDate, localDate, type Me } from '@mono/shared';
import { EmptyState, ErrorState, KpiTile, PageHeader, PageSkeleton } from '@/components/page';
import { StatusChip } from '@/components/status-chip';
import { Button } from '@/components/ui/button';
import { DateInput } from '@/components/ui/date-input';
import { Dialog } from '@/components/ui/dialog';
import { Field, Select, Textarea } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Chips, YesNo } from '@/modules/hr/ui';
import { useUsers } from '@/modules/system/api';
import { crmApi, inr, toPaise, useCrmMutation, useFunnel, type LeadCard } from './api';
import { MoneyInput } from './setup/shell';
import { rupeeText } from './setup/format';

type Funnel = NonNullable<ReturnType<typeof useFunnel>['data']>;

/** Sales CRM → NBD funnel (§11.2): enquiries to qualify, leads by stage with days against plan, won and lost. */
export function NbdPage({ me }: { me: Me }) {
  const { t } = useTranslation();
  const [owner, setOwner] = useState('');
  const q = useFunnel(owner || undefined);
  const users = useUsers();
  const [adding, setAdding] = useState(false);
  const [lead, setLead] = useState<LeadCard | null>(null);
  const today = localDate(new Date(), me.company.timezone);
  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  const d = q.data;
  return (
    <div className="space-y-5">
      <PageHeader title={t('nav.nbd')} subtitle={t('navDesc.nbd')} />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <KpiTile label={t('crm.n.toQualify')} value={d.tiles.toQualify} hero />
        <KpiTile label={t('crm.n.open')} value={d.tiles.open} note={inr(d.tiles.inFunnel, true)} />
        <KpiTile label={t('crm.n.stuck')} value={d.tiles.stuck} tone={d.tiles.stuck ? 'bad' : undefined} />
        <KpiTile label={t('crm.n.noNext')} value={d.tiles.noNext} tone={d.tiles.noNext ? 'bad' : undefined} />
        <KpiTile label={t('crm.n.won90')} value={inr(d.tiles.won90, true)} />
        <KpiTile
          label={t('crm.n.winRate')}
          value={d.tiles.winRatePct === null ? '—' : `${d.tiles.winRatePct}%`}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        {d.canPickOwner && (
          <Select
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
            aria-label={t('crm.n.owner')}
            className="w-52"
          >
            <option value="">{t('crm.n.everyone')}</option>
            {(users.data ?? [])
              .filter((u) => u.status === 'ACTIVE')
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
          </Select>
        )}
        <Button className="ml-auto" onClick={() => setAdding(true)}>
          <Plus /> {t('crm.n.newEnquiry')}
        </Button>
      </div>
      <section className="space-y-2">
        <h2 className="text-sm font-semibold">{t('crm.n.enquiries', { count: d.enquiries.length })}</h2>
        {!d.enquiries.length ? (
          <p className="text-sm text-muted-foreground">{t('crm.n.noEnquiries')}</p>
        ) : (
          <ul className="divide-y rounded-card border bg-card">
            {d.enquiries.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                <div className="min-w-0">
                  <div className="font-medium">
                    {l.company || l.name}{' '}
                    <span className="font-mono text-xs text-muted-foreground">{l.number}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {[
                      l.name,
                      l.city,
                      l.mobile,
                      l.source,
                      formatLocalDate(localDate(new Date(l.createdAt), me.company.timezone)),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                  {l.requirement && <div className="text-xs">{l.requirement}</div>}
                </div>
                <Button size="sm" onClick={() => setLead(l)}>
                  {t('crm.n.qualify')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
      {!d.columns.some((c) => c.leads.length) && !d.enquiries.length ? (
        <EmptyState icon={Funnel} title={t('crm.n.empty')} body={t('crm.n.emptyBody')} />
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {d.columns.map((c) => (
            <section
              key={c.key}
              className="w-72 shrink-0 space-y-2 rounded-card bg-muted/40 p-2"
              aria-label={c.name}
            >
              <h2 className="flex items-center justify-between px-1 text-sm font-semibold">
                {c.name}
                <span className="text-xs font-normal text-muted-foreground">
                  {t('crm.n.planDays', { n: c.days })} · {c.leads.length}
                </span>
              </h2>
              {c.leads.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => setLead(l)}
                  className="w-full space-y-1 rounded-card border bg-card p-3 text-left text-sm hover:shadow-sm"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="min-w-0 truncate font-medium">{l.company || l.name}</span>
                    <b className="tabular-nums">{inr(l.value, true)}</b>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {[l.name, l.city, l.source].filter(Boolean).join(' · ')}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    <StatusChip tone={l.stuck ? 'bad' : 'ok'}>
                      {l.stuck ? t('crm.n.stuckChip') : t('crm.n.onTrack')}
                    </StatusChip>
                    <span className="text-muted-foreground">
                      {t('crm.n.inStage', { days: l.daysInStage, plan: l.plannedDays ?? '—' })}
                    </span>
                  </div>
                  <div className={l.noNext ? 'text-xs text-status-bad-fg' : 'text-xs'}>
                    {l.nextAction
                      ? `${l.nextAction} · ${formatLocalDate(l.nextActionOn!)}`
                      : t('crm.n.noNextAction')}
                    {l.owner && <span className="text-muted-foreground"> · {l.owner}</span>}
                  </div>
                </button>
              ))}
            </section>
          ))}
        </div>
      )}
      {adding && <EnquiryDialog funnel={d} onClose={() => setAdding(false)} />}
      {lead && <LeadDialog lead={lead} funnel={d} today={today} onClose={() => setLead(null)} />}
    </div>
  );
}

function EnquiryDialog({ funnel, onClose }: { funnel: Funnel; onClose: () => void }) {
  const { t } = useTranslation();
  const [v, setV] = useState({
    name: '',
    company: '',
    mobile: '',
    email: '',
    city: '',
    source: funnel.sources[0] ?? '',
    requirement: '',
    value: '',
    buyWhen: '',
  });
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) =>
    setV({ ...v, [k]: e.target.value });
  const ok =
    v.name.trim().length >= 2 &&
    /^\+?[0-9 -]{8,16}$/.test(v.mobile) &&
    v.city.trim().length >= 2 &&
    v.source &&
    v.requirement.trim().length >= 2;
  const save = useCrmMutation(
    () =>
      crmApi.enquiry({
        ...v,
        company: v.company || null,
        email: v.email || null,
        buyWhen: v.buyWhen || null,
        value: toPaise(v.value) ?? 0,
      }),
    () => t('crm.n.added'),
  );
  const f = funnel.fields;
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('crm.n.newEnquiry')}
      footer={
        <Button
          disabled={!ok || save.isPending}
          onClick={() => save.mutate(undefined, { onSuccess: onClose })}
        >
          {save.isPending && <Loader2 className="animate-spin" />} {t('common.save')}
        </Button>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('crm.n.name')}>
          <Input value={v.name} onChange={set('name')} />
        </Field>
        {f.company && (
          <Field label={t('crm.n.company')}>
            <Input value={v.company} onChange={set('company')} />
          </Field>
        )}
        <Field label={t('crm.c.mobile')}>
          <Input inputMode="tel" value={v.mobile} onChange={set('mobile')} />
        </Field>
        {f.email && (
          <Field label={t('crm.c.email')}>
            <Input inputMode="email" value={v.email} onChange={set('email')} />
          </Field>
        )}
        <Field label={t('crm.c.city')}>
          <Input value={v.city} onChange={set('city')} />
        </Field>
        <Field label={t('crm.n.source')}>
          <Select value={v.source} onChange={set('source')} aria-label={t('crm.n.source')}>
            {funnel.sources.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </Field>
        {f.budget && (
          <Field label={t('crm.n.value')}>
            <MoneyInput
              label={t('crm.n.value')}
              value={v.value}
              onChange={(value) => setV({ ...v, value })}
            />
          </Field>
        )}
        {f.when && (
          <Field label={t('crm.n.when')}>
            <Input value={v.buyWhen} onChange={set('buyWhen')} placeholder={t('crm.n.whenPh')} />
          </Field>
        )}
        <Field label={t('crm.n.requirement')} className="sm:col-span-2">
          <Textarea rows={2} value={v.requirement} onChange={set('requirement')} />
        </Field>
      </div>
    </Dialog>
  );
}

/** Qualify an enquiry, or move / win / lose a lead (every move needs the next action and its date). */
function LeadDialog({
  lead,
  funnel,
  today,
  onClose,
}: {
  lead: LeadCard;
  funnel: Funnel;
  today: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const enquiry = lead.status === 'ENQUIRY';
  const stages = funnel.stages;
  const at = stages.findIndex((s) => s.key === lead.stage);
  const [mode, setMode] = useState<'qualify' | 'disqualify' | 'move' | 'win' | 'lose'>(
    enquiry ? 'qualify' : 'move',
  );
  const [answers, setAnswers] = useState<Record<string, boolean>>(
    Object.fromEntries(funnel.questions.map((q) => [q, false])),
  );
  const [value, setValue] = useState(rupeeText(Number(lead.value)));
  const [stage, setStage] = useState(stages[Math.min(at + 1, stages.length - 1)]?.key ?? '');
  const [next, setNext] = useState(lead.nextAction ?? '');
  const [on, setOn] = useState(addDays(today, 2));
  const [reason, setReason] = useState('');
  const needsNext = mode === 'qualify' || mode === 'move';
  const ok =
    (!needsNext || (next.trim().length >= 2 && on >= today)) &&
    (mode !== 'qualify' || Object.values(answers).every(Boolean)) &&
    (mode !== 'lose' && mode !== 'disqualify' ? true : reason.trim().length >= 3) &&
    (mode !== 'move' || stage !== lead.stage);
  const save = useCrmMutation(
    () =>
      crmApi.leadAction(lead.id, {
        action: mode,
        answers: mode === 'qualify' ? answers : undefined,
        value: mode === 'qualify' ? (toPaise(value) ?? 0) : undefined,
        stage: mode === 'move' ? stage : undefined,
        nextAction: needsNext ? next.trim() : undefined,
        nextActionOn: needsNext ? on : undefined,
        reason: reason.trim() || undefined,
      }),
    (r) => (r.customerId ? t('crm.n.wonToast') : t('crm.s.saved')),
  );
  const modes = enquiry ? (['qualify', 'disqualify'] as const) : (['move', 'win', 'lose'] as const);
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={lead.company || lead.name}
      description={[lead.name, lead.city, lead.mobile, lead.source].filter(Boolean).join(' · ')}
      footer={
        <Button
          disabled={!ok || save.isPending}
          onClick={() => save.mutate(undefined, { onSuccess: onClose })}
        >
          {save.isPending ? (
            <Loader2 className="animate-spin" />
          ) : mode === 'win' ? (
            <Trophy />
          ) : mode === 'lose' || mode === 'disqualify' ? (
            <X />
          ) : mode === 'move' ? (
            <ArrowRight />
          ) : (
            <Check />
          )}{' '}
          {t(`crm.n.do.${mode}`)}
        </Button>
      }
    >
      <div className="space-y-4 text-sm">
        {lead.requirement && <p className="rounded-control bg-muted/40 px-3 py-2">{lead.requirement}</p>}
        <Chips
          label={t('crm.n.what')}
          value={mode}
          onChange={setMode}
          options={modes.map((m) => ({ value: m, label: t(`crm.n.mode.${m}`) }))}
        />
        {mode === 'qualify' && (
          <>
            {funnel.questions.map((q) => (
              <div key={q} className="flex flex-wrap items-center justify-between gap-2">
                <span>{q}</span>
                <YesNo
                  label={q}
                  value={answers[q] ?? false}
                  onChange={(v) => setAnswers({ ...answers, [q]: v })}
                />
              </div>
            ))}
            <Field label={t('crm.n.value')}>
              <MoneyInput label={t('crm.n.value')} value={value} onChange={setValue} />
            </Field>
          </>
        )}
        {mode === 'move' && (
          <Field label={t('crm.n.toStage')}>
            <Select value={stage} onChange={(e) => setStage(e.target.value)} aria-label={t('crm.n.toStage')}>
              {stages.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {needsNext && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('crm.n.nextAction')}>
              <Input value={next} onChange={(e) => setNext(e.target.value)} />
            </Field>
            <Field label={t('crm.n.on')}>
              <DateInput value={on} min={today} onChange={setOn} aria-label={t('crm.n.on')} />
            </Field>
          </div>
        )}
        {(mode === 'lose' || mode === 'disqualify') && (
          <Field label={t('crm.n.why')}>
            <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        )}
        {mode === 'win' && <p className="text-muted-foreground">{t('crm.n.winHint')}</p>}
      </div>
    </Dialog>
  );
}
