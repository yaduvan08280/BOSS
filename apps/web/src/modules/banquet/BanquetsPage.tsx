import { PartyPopper, Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { hasPermission, type Me } from '@mono/shared';
import { EmptyState, ErrorState, KpiTile, PageHeader, PageSkeleton } from '@/components/page';
import { StatusChip } from '@/components/status-chip';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DateInput } from '@/components/ui/date-input';
import { Dialog } from '@/components/ui/dialog';
import { Field, Select } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { TimeInput } from '@/components/ui/date-input';
import { rupees } from '@/modules/stock/api';
import { Seg } from '@/modules/stock/ui';
import {
  dmy,
  EVENT_TONE,
  send,
  useBanquetMutation,
  useEvents,
  useHalls,
  useHospBranch,
  usePackages,
  type Hall,
} from './api';
import { EventDialog } from './EventDialog';

const mins = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Banquets (phase 18): events from enquiry to the final bill, and the halls and packages they are sold from. */
export function BanquetsPage({ me }: { me: Me }) {
  const { t } = useTranslation();
  const b = useHospBranch();
  const events = useEvents(b.branchId);
  const halls = useHalls(b.branchId);
  const packages = usePackages();
  const [tab, setTab] = useState<'events' | 'setup'>('events');
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [hall, setHall] = useState({ name: '', guests: '', rent: '' });
  const [pack, setPack] = useState({ name: '', price: '' });
  const canSell = hasPermission(me.user.permissions, 'hosp.create');
  const canSetUp = hasPermission(me.user.permissions, 'hosp.admin');
  const addHall = useBanquetMutation(
    () =>
      send('/api/banquets/halls', {
        branchId: b.branchId,
        name: hall.name,
        capacities: [{ style: 'Seated', guests: Number(hall.guests) }],
        rent: Math.round(Number(hall.rent || 0) * 100),
      }),
    t('bq.hallSaved'),
  );
  const addPack = useBanquetMutation(
    () =>
      send('/api/banquets/packages', {
        name: pack.name,
        pricePerPlate: Math.round(Number(pack.price) * 100),
      }),
    t('bq.packageSaved'),
  );
  if (b.loading) return <PageSkeleton />;
  if (!b.list.length)
    return <EmptyState icon={PartyPopper} title={t('pos.noOutlet')} body={t('pos.noOutletBody')} />;
  const list = events.data?.events ?? [];
  const open = list.find((e) => e.id === openId);
  const count = (s: string) => list.filter((e) => e.status === s).length;
  return (
    <div>
      <PageHeader
        title={t('bq.title')}
        subtitle={t('bq.subtitle')}
        actions={
          canSell &&
          (halls.data ?? []).length > 0 && (
            <Button size="sm" variant="primary" onClick={() => setAdding(true)}>
              <Plus /> {t('bq.newEnquiry')}
            </Button>
          )
        }
      />
      <div className="mb-4 w-full sm:w-64">
        <Select
          aria-label={t('bq.branch')}
          value={b.branchId}
          onChange={(e) => b.setBranchId(e.target.value)}
        >
          {b.list.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </Select>
      </div>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTile hero label={t('bq.status.CONFIRMED')} value={String(count('CONFIRMED'))} />
        <KpiTile label={t('bq.status.ENQUIRY')} value={String(count('ENQUIRY'))} />
        <KpiTile label={t('bq.status.QUOTED')} value={String(count('QUOTED'))} />
        <KpiTile label={t('bq.status.COMPLETED')} value={String(count('COMPLETED'))} />
      </div>
      <Seg
        value={tab}
        onChange={setTab}
        options={[
          { key: 'events', label: t('bq.events') },
          { key: 'setup', label: t('bq.setup') },
        ]}
      />
      {tab === 'events' ? (
        events.isPending ? (
          <PageSkeleton />
        ) : events.isError ? (
          <ErrorState onRetry={() => void events.refetch()} />
        ) : list.length === 0 ? (
          <EmptyState icon={PartyPopper} title={t('bq.none')} body={t('bq.noneBody')} />
        ) : (
          <ul className="space-y-2">
            {list.map((e) => (
              <li key={e.id}>
                <button type="button" className="w-full text-left" onClick={() => setOpenId(e.id)}>
                  <Card className="flex flex-wrap items-center justify-between gap-3 p-3">
                    <div className="min-w-0">
                      <div className="font-medium">
                        {e.occasion} · {e.guest?.name}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        <span className="font-mono">{e.number}</span> · {dmy(e.day)} {e.from}–{e.to} ·{' '}
                        {e.halls.map((h) => h.name).join(' + ')} · {e.guaranteedCovers ?? e.expectedCovers}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {e.totals.total > 0 && (
                        <span className="tabular text-sm">{rupees(e.totals.total)}</span>
                      )}
                      <StatusChip tone={EVENT_TONE[e.status]}>{t(`bq.status.${e.status}`)}</StatusChip>
                    </div>
                  </Card>
                </button>
              </li>
            ))}
          </ul>
        )
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          <section className="space-y-2">
            <h2 className="text-sm font-semibold">{t('bq.halls')}</h2>
            {(halls.data ?? []).map((h) => (
              <Card key={h.id} className="flex justify-between p-3 text-sm">
                <span className="font-medium">{h.name}</span>
                <span className="text-muted-foreground">
                  {h.capacities.map((c) => `${c.style} ${c.guests}`).join(' · ')} · {rupees(h.rent)}
                </span>
              </Card>
            ))}
            {canSetUp && (
              <div className="grid gap-2 sm:grid-cols-4">
                <Field label={t('bq.hallName')} className="sm:col-span-2">
                  <Input value={hall.name} onChange={(e) => setHall({ ...hall, name: e.target.value })} />
                </Field>
                <Field label={t('bq.hallGuests')}>
                  <Input
                    inputMode="numeric"
                    value={hall.guests}
                    onChange={(e) => setHall({ ...hall, guests: e.target.value })}
                  />
                </Field>
                <Field label={t('bq.hallRent')}>
                  <Input
                    inputMode="decimal"
                    value={hall.rent}
                    onChange={(e) => setHall({ ...hall, rent: e.target.value })}
                  />
                </Field>
                <Button
                  size="sm"
                  disabled={!hall.name.trim() || !(Number(hall.guests) > 0) || addHall.isPending}
                  onClick={() =>
                    addHall.mutate(undefined, {
                      onSuccess: () => setHall({ name: '', guests: '', rent: '' }),
                    })
                  }
                >
                  {t('bq.addHall')}
                </Button>
              </div>
            )}
          </section>
          <section className="space-y-2">
            <h2 className="text-sm font-semibold">{t('bq.packages')}</h2>
            {(packages.data ?? []).map((p) => (
              <Card key={p.id} className="flex justify-between p-3 text-sm">
                <span className="font-medium">{p.name}</span>
                <span className="tabular text-muted-foreground">
                  {t('bq.perPlate', { price: rupees(p.pricePerPlate) })}
                </span>
              </Card>
            ))}
            {canSetUp && (
              <div className="grid gap-2 sm:grid-cols-3">
                <Field label={t('bq.packageName')} className="sm:col-span-2">
                  <Input value={pack.name} onChange={(e) => setPack({ ...pack, name: e.target.value })} />
                </Field>
                <Field label={t('bq.platePrice')}>
                  <Input
                    inputMode="decimal"
                    value={pack.price}
                    onChange={(e) => setPack({ ...pack, price: e.target.value })}
                  />
                </Field>
                <Button
                  size="sm"
                  disabled={!pack.name.trim() || !(Number(pack.price) > 0) || addPack.isPending}
                  onClick={() =>
                    addPack.mutate(undefined, { onSuccess: () => setPack({ name: '', price: '' }) })
                  }
                >
                  {t('bq.addPackage')}
                </Button>
              </div>
            )}
          </section>
        </div>
      )}
      {adding && events.data && (
        <EnquiryDialog
          branchId={b.branchId}
          today={events.data.today}
          halls={halls.data ?? []}
          onClose={() => setAdding(false)}
        />
      )}
      {open && <EventDialog key={open.id} event={open} canSell={canSell} onClose={() => setOpenId(null)} />}
    </div>
  );
}

/** A new enquiry: who, the occasion, the day and time, the hall, how many. */
function EnquiryDialog({
  branchId,
  today,
  halls,
  onClose,
}: {
  branchId: string;
  today: string;
  halls: Hall[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [f, setF] = useState({
    name: '',
    mobile: '',
    occasion: '',
    day: today,
    from: '19:00',
    to: '23:00',
    hallId: halls[0]?.id ?? '',
    covers: '100',
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF((x) => ({ ...x, [k]: e.target.value }));
  const add = useBanquetMutation(
    () =>
      send<{ number: string }>('/api/banquets/events', {
        branchId,
        guest: { name: f.name, mobile: f.mobile },
        occasion: f.occasion,
        day: f.day,
        startMin: mins(f.from),
        endMin: mins(f.to) <= mins(f.from) ? mins(f.to) + 1440 : mins(f.to),
        hallIds: [f.hallId],
        expectedCovers: Number(f.covers),
      }),
    (e) => t('bq.enquirySaved', { number: e.number }),
  );
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('bq.newEnquiry')}
      footer={
        <Button
          variant="primary"
          disabled={
            !f.name.trim() ||
            f.mobile.trim().length < 8 ||
            !f.occasion.trim() ||
            !f.hallId ||
            !(Number(f.covers) > 0) ||
            add.isPending
          }
          onClick={() => add.mutate(undefined, { onSuccess: onClose })}
        >
          {t('bq.saveEnquiry')}
        </Button>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('res.name')}>
          <Input value={f.name} onChange={set('name')} />
        </Field>
        <Field label={t('res.mobile')}>
          <Input inputMode="tel" value={f.mobile} onChange={set('mobile')} />
        </Field>
        <Field label={t('res.occasion')}>
          <Input value={f.occasion} onChange={set('occasion')} />
        </Field>
        <Field label={t('bq.hall')}>
          <Select value={f.hallId} onChange={set('hallId')}>
            {halls.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('res.day')}>
          <DateInput
            value={f.day}
            min={today}
            onChange={(v) => setF((x) => ({ ...x, day: v }))}
            aria-label={t('res.day')}
          />
        </Field>
        <Field label={t('bq.expected')}>
          <Input inputMode="numeric" value={f.covers} onChange={set('covers')} />
        </Field>
        <Field label={t('bq.from')}>
          <TimeInput
            value={f.from}
            onChange={(v) => setF((x) => ({ ...x, from: v }))}
            aria-label={t('bq.from')}
          />
        </Field>
        <Field label={t('bq.to')}>
          <TimeInput value={f.to} onChange={(v) => setF((x) => ({ ...x, to: v }))} aria-label={t('bq.to')} />
        </Field>
      </div>
    </Dialog>
  );
}
