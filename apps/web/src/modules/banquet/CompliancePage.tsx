import { ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { COMPLIANCE_KINDS, hasPermission, type Me } from '@mono/shared';
import { EmptyState, ErrorState, KpiTile, PageHeader, PageSkeleton } from '@/components/page';
import { StatusChip } from '@/components/status-chip';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DateInput } from '@/components/ui/date-input';
import { Field, Select } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Seg } from '@/modules/stock/ui';
import { dmy, send, useBanquetMutation, useCompliance, useHospBranch, useTemps } from './api';

const TONE = { VALID: 'ok', EXPIRING: 'warn', EXPIRED: 'bad' } as const;

/** Compliance (phase 18): licences and duties with the day they run out, and the HACCP temperature log. */
export function CompliancePage({ me }: { me: Me }) {
  const { t } = useTranslation();
  const b = useHospBranch();
  const list = useCompliance(b.branchId);
  const temps = useTemps(b.branchId);
  const [tab, setTab] = useState<'licences' | 'temps'>('licences');
  const [f, setF] = useState({ kind: 'FSSAI', name: '', number: '', expiresOn: '', every: '' });
  const [renew, setRenew] = useState<Record<string, string>>({});
  const [p, setP] = useState({ name: '', min: '', max: '' });
  const [read, setRead] = useState<Record<string, { value: string; action: string }>>({});
  const canWork = hasPermission(me.user.permissions, 'hosp.create');
  const canManage = hasPermission(me.user.permissions, 'hosp.edit');
  const add = useBanquetMutation(
    () =>
      send('/api/compliance', {
        branchId: b.branchId,
        kind: f.kind,
        name: f.name,
        number: f.number || null,
        expiresOn: f.expiresOn,
        everyDays: Number(f.every) > 0 ? Number(f.every) : null,
      }),
    t('cmp.saved'),
  );
  const doRenew = useBanquetMutation(
    (x: { id: string; expiresOn?: string }) =>
      send(`/api/compliance/${x.id}/renew`, x.expiresOn ? { expiresOn: x.expiresOn } : {}),
    t('cmp.renewed'),
  );
  const addPoint = useBanquetMutation(
    () =>
      send('/api/compliance/temps', {
        branchId: b.branchId,
        name: p.name,
        min: p.min === '' ? null : Number(p.min),
        max: p.max === '' ? null : Number(p.max),
      }),
    t('cmp.saved'),
  );
  const log = useBanquetMutation(
    (x: { id: string; value: number; action: string }) =>
      send<{ ok: boolean }>(`/api/compliance/temps/${x.id}/readings`, {
        value: x.value,
        action: x.action || null,
      }),
    (r) => (r.ok ? t('cmp.logged') : t('cmp.loggedOut')),
  );
  if (b.loading) return <PageSkeleton />;
  if (!b.list.length)
    return <EmptyState icon={ShieldCheck} title={t('pos.noOutlet')} body={t('pos.noOutletBody')} />;
  const d = list.data;
  return (
    <div>
      <PageHeader title={t('cmp.title')} subtitle={t('cmp.subtitle')} />
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
      {d && (
        <div className="mb-4 grid grid-cols-3 gap-3">
          <KpiTile hero label={t('cmp.state.EXPIRED')} value={String(d.counts.expired)} />
          <KpiTile label={t('cmp.state.EXPIRING')} value={String(d.counts.expiring)} />
          <KpiTile label={t('cmp.state.VALID')} value={String(d.counts.valid)} />
        </div>
      )}
      <Seg
        value={tab}
        onChange={setTab}
        options={[
          { key: 'licences', label: t('cmp.licences') },
          { key: 'temps', label: t('cmp.temps') },
        ]}
      />
      {tab === 'licences' ? (
        list.isPending ? (
          <PageSkeleton />
        ) : list.isError || !d ? (
          <ErrorState onRetry={() => void list.refetch()} />
        ) : (
          <div className="space-y-4">
            {d.items.length === 0 && (
              <EmptyState icon={ShieldCheck} title={t('cmp.none')} body={t('cmp.noneBody')} />
            )}
            <ul className="space-y-2">
              {d.items.map((c) => (
                <li key={c.id}>
                  <Card
                    className="flex flex-wrap items-center justify-between gap-3 p-3"
                    data-testid={`cmp-${c.name}`}
                  >
                    <div className="min-w-0">
                      <div className="font-medium">{c.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {c.number ? `${c.number} · ` : ''}
                        {t('cmp.until', { day: dmy(c.expiresOn) })}
                        {c.everyDays ? ` · ${t('cmp.every', { days: c.everyDays })}` : ''}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusChip tone={TONE[c.state]}>{t(`cmp.state.${c.state}`)}</StatusChip>
                      {canWork &&
                        (c.everyDays ? (
                          <Button size="sm" onClick={() => doRenew.mutate({ id: c.id })}>
                            {t('cmp.done')}
                          </Button>
                        ) : (
                          <>
                            <div className="w-36">
                              <DateInput
                                value={renew[c.id] ?? ''}
                                min={d.today}
                                onChange={(v) => setRenew((x) => ({ ...x, [c.id]: v }))}
                                aria-label={t('cmp.newDay', { name: c.name })}
                              />
                            </div>
                            <Button
                              size="sm"
                              disabled={!renew[c.id]}
                              onClick={() => doRenew.mutate({ id: c.id, expiresOn: renew[c.id] })}
                            >
                              {t('cmp.renew')}
                            </Button>
                          </>
                        ))}
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
            {canManage && (
              <Card className="grid gap-2 p-3 sm:grid-cols-5">
                <Field label={t('cmp.kind')}>
                  <Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
                    {COMPLIANCE_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {t(`cmp.kinds.${k}`)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t('cmp.name')}>
                  <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
                </Field>
                <Field label={t('cmp.number')}>
                  <Input value={f.number} onChange={(e) => setF({ ...f, number: e.target.value })} />
                </Field>
                <Field label={t('cmp.expires')}>
                  <DateInput
                    value={f.expiresOn}
                    onChange={(v) => setF({ ...f, expiresOn: v })}
                    aria-label={t('cmp.expires')}
                  />
                </Field>
                <Field label={t('cmp.everyDays')}>
                  <Input
                    inputMode="numeric"
                    value={f.every}
                    onChange={(e) => setF({ ...f, every: e.target.value })}
                  />
                </Field>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={!f.name.trim() || !f.expiresOn || add.isPending}
                  onClick={() =>
                    add.mutate(undefined, {
                      onSuccess: () => setF({ ...f, name: '', number: '', expiresOn: '', every: '' }),
                    })
                  }
                >
                  {t('cmp.add')}
                </Button>
              </Card>
            )}
          </div>
        )
      ) : (
        <div className="space-y-4">
          <ul className="grid gap-2 sm:grid-cols-2">
            {(temps.data?.points ?? []).map((x) => {
              const r = read[x.id] ?? { value: '', action: '' };
              return (
                <li key={x.id}>
                  <Card className="space-y-2 p-3" data-testid={`temp-${x.name}`}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">{x.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {t('cmp.limits', { min: x.min ?? '—', max: x.max ?? '—', unit: x.unit })}
                      </span>
                    </div>
                    {x.last && (
                      <StatusChip tone={x.last.ok ? 'ok' : 'bad'}>
                        {t(x.last.ok ? 'cmp.lastOk' : 'cmp.lastOut', { value: x.last.value, unit: x.unit })}
                      </StatusChip>
                    )}
                    {canWork && (
                      <div className="grid gap-2 sm:grid-cols-[90px_1fr_auto]">
                        <Field label={t('cmp.reading')}>
                          <Input
                            inputMode="decimal"
                            value={r.value}
                            onChange={(e) =>
                              setRead((y) => ({ ...y, [x.id]: { ...r, value: e.target.value } }))
                            }
                          />
                        </Field>
                        <Field label={t('cmp.action')}>
                          <Input
                            value={r.action}
                            onChange={(e) =>
                              setRead((y) => ({ ...y, [x.id]: { ...r, action: e.target.value } }))
                            }
                          />
                        </Field>
                        <Button
                          size="sm"
                          className="self-end"
                          disabled={r.value === '' || log.isPending}
                          onClick={() =>
                            log.mutate(
                              { id: x.id, value: Number(r.value), action: r.action },
                              {
                                onSuccess: () =>
                                  setRead((y) => ({ ...y, [x.id]: { value: '', action: '' } })),
                              },
                            )
                          }
                        >
                          {t('cmp.log')}
                        </Button>
                      </div>
                    )}
                  </Card>
                </li>
              );
            })}
          </ul>
          {canManage && (
            <Card className="grid gap-2 p-3 sm:grid-cols-4">
              <Field label={t('cmp.point')}>
                <Input value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} />
              </Field>
              <Field label={t('cmp.min')}>
                <Input
                  inputMode="decimal"
                  value={p.min}
                  onChange={(e) => setP({ ...p, min: e.target.value })}
                />
              </Field>
              <Field label={t('cmp.max')}>
                <Input
                  inputMode="decimal"
                  value={p.max}
                  onChange={(e) => setP({ ...p, max: e.target.value })}
                />
              </Field>
              <Button
                size="sm"
                className="self-end"
                disabled={!p.name.trim() || addPoint.isPending}
                onClick={() =>
                  addPoint.mutate(undefined, { onSuccess: () => setP({ name: '', min: '', max: '' }) })
                }
              >
                {t('cmp.addPoint')}
              </Button>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
