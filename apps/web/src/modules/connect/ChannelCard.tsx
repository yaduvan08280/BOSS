import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { addDays, hasPermission, type Me } from '@mono/shared';
import { EmptyState, PageSkeleton } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, Select, Switch } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { BedDouble } from 'lucide-react';
import { useHotelRules, usePlans, useProperty } from '@/modules/hotel/api';
import { CopyButton } from '@/modules/system/apikeys/SecretOnce';
import { dmy, send, useConnectMutation, useOverbooked, type Connection } from './api';
import { ConnState } from './GatewayCard';

/**
 * A property's channels: its own booking page (a switch and a link), the channel manager (address, token, which
 * room type is which room there, the plan whose rates are sent), sending rates and availability, asking for new
 * bookings, and the bookings a channel oversold.
 */
export function ChannelCard({
  connections,
  canAdmin,
  me,
}: {
  connections: Connection[];
  canAdmin: boolean;
  me: Me;
}) {
  const { t } = useTranslation();
  const p = useProperty();
  const plans = usePlans(p.branchId);
  const rules = useHotelRules(p.branchId);
  const over = useOverbooked(p.branchId);
  const conn = connections.find((c) => c.branchId === p.branchId && c.active);
  const canManage = hasPermission(me.user.permissions, 'hosp.edit');
  const canSetUp = hasPermission(me.user.permissions, 'hosp.admin');
  const page = useConnectMutation(
    (online: boolean) => send(`/api/hotel/rules?branchId=${p.branchId}`, { online }, 'PUT'),
    t('connect.saved'),
  );
  const today = rules.data?.businessDate ?? '';
  if (p.loading) return <PageSkeleton />;
  if (!p.list.length)
    return <EmptyState icon={BedDouble} title={t('connect.noProperty')} body={t('connect.noPropertyBody')} />;
  const link = (rules.data as { bookingToken?: string | null } | undefined)?.bookingToken;
  const url = link ? `${window.location.origin}/rooms/${link}` : null;
  return (
    <div className="space-y-4">
      <div className="w-full sm:w-64">
        <Select
          aria-label={t('connect.property')}
          value={p.branchId}
          onChange={(e) => p.setBranchId(e.target.value)}
        >
          {p.list.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </Select>
      </div>
      <Card className="space-y-3 p-4" data-testid="rooms-page-card">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold">{t('connect.roomsPage')}</h3>
            <p className="text-xs text-muted-foreground">{t('connect.roomsPageHint')}</p>
          </div>
          <Switch
            aria-label={t('connect.roomsPage')}
            checked={Boolean(rules.data?.rules.online)}
            disabled={!canSetUp || page.isPending}
            onCheckedChange={(on) => page.mutate(on)}
          />
        </div>
        {url && (
          <div className="flex items-center gap-2 rounded-control border bg-muted/50 p-2">
            <code className="min-w-0 flex-1 font-mono text-xs break-all" data-testid="rooms-link">
              {url}
            </code>
            <CopyButton value={url} />
          </div>
        )}
      </Card>
      {/* A fresh form for each property and connection: its fields start from what is saved. */}
      <ChannelForm
        key={`${p.branchId}:${conn?.id ?? ''}`}
        branchId={p.branchId}
        conn={conn}
        types={p.types}
        plans={plans.data ?? []}
        canAdmin={canAdmin}
        canManage={canManage}
        today={today}
      />
      {(over.data?.length ?? 0) > 0 && (
        <Card className="space-y-2 p-4" data-testid="overbooked">
          <h3 className="font-semibold">{t('connect.overbookedTitle')}</h3>
          <p className="text-xs text-muted-foreground">{t('connect.overbookedHint')}</p>
          <ul className="space-y-1 text-sm">
            {over.data!.map((s) => (
              <li key={s.id}>
                <span className="font-mono">{s.number}</span> · {s.guest} · {dmy(s.arrive)} → {dmy(s.depart)}{' '}
                · {s.channel} {s.channelRef}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function ChannelForm({
  branchId,
  conn,
  types,
  plans,
  canAdmin,
  canManage,
  today,
}: {
  branchId: string;
  conn: Connection | undefined;
  types: { id: string; name: string }[];
  plans: { id: string; name: string }[];
  canAdmin: boolean;
  canManage: boolean;
  today: string;
}) {
  const { t } = useTranslation();
  const [baseUrl, setBaseUrl] = useState(conn?.baseUrl ?? '');
  const [token, setToken] = useState('');
  const [codes, setCodes] = useState<Record<string, string>>(
    Object.fromEntries((conn?.rooms ?? []).map((r) => [r.roomTypeId, r.code])),
  );
  const [planId, setPlanId] = useState(conn?.defaultPlanId ?? '');
  const save = useConnectMutation(
    () =>
      send(
        '/api/connect/connections',
        {
          kind: 'CHANNEL',
          branchId,
          provider: 'GENERIC',
          baseUrl,
          ...(token ? { secret: { token } } : {}),
          rooms: Object.entries(codes)
            .filter(([, code]) => code.trim())
            .map(([roomTypeId, code]) => ({ roomTypeId, code: code.trim() })),
          defaultPlanId: planId || null,
        },
        'PUT',
      ),
    t('connect.saved'),
  );
  const push = useConnectMutation(
    () =>
      send<{ sent: number; ok: boolean; error: string | null }>('/api/connect/channel/push', {
        branchId,
        from: today,
        to: addDays(today, 30),
      }),
    (r) => (r.ok ? t('connect.pushed', { count: r.sent }) : t('connect.pushWaits')),
  );
  const pull = useConnectMutation(
    () => send<{ taken: number; failed: number }>('/api/connect/channel/pull', { branchId }),
    (r) => t('connect.pulled', { taken: r.taken, failed: r.failed }),
  );
  return (
    <Card className="space-y-3 p-4" data-testid="channel-card">
      <div>
        <h3 className="font-semibold">{t('connect.channel')}</h3>
        <p className="text-xs text-muted-foreground">{t('connect.channelHint')}</p>
      </div>
      <ConnState c={conn} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('connect.address')}>
          <Input
            inputMode="url"
            placeholder="https://"
            disabled={!canAdmin}
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
          />
        </Field>
        <Field label={t('connect.key.token')}>
          <Input
            type="password"
            autoComplete="off"
            disabled={!canAdmin}
            placeholder={conn ? t('connect.keepKey') : ''}
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
        </Field>
      </div>
      <div className="space-y-2">
        <div className="text-sm font-medium">{t('connect.roomCodes')}</div>
        {types.map((ty) => (
          <div key={ty.id} className="flex items-center gap-3">
            <span className="min-w-0 flex-1 truncate text-sm">{ty.name}</span>
            <div className="w-40">
              <Input
                aria-label={t('connect.codeFor', { name: ty.name })}
                disabled={!canAdmin}
                value={codes[ty.id] ?? ''}
                onChange={(e) => setCodes((x) => ({ ...x, [ty.id]: e.target.value }))}
              />
            </div>
          </div>
        ))}
      </div>
      <Field label={t('connect.plan')}>
        <Select
          aria-label={t('connect.plan')}
          disabled={!canAdmin}
          value={planId}
          onChange={(e) => setPlanId(e.target.value)}
        >
          <option value="">—</option>
          {plans.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </Select>
      </Field>
      <div className="flex flex-wrap gap-2">
        {canAdmin && (
          <Button
            disabled={save.isPending || !baseUrl || (!conn && !token)}
            onClick={() => save.mutate(undefined)}
          >
            {t('connect.save')}
          </Button>
        )}
        {conn && canManage && (
          <>
            <Button
              variant="secondary"
              disabled={push.isPending || !today}
              onClick={() => push.mutate(undefined)}
            >
              {t('connect.push')}
            </Button>
            <Button variant="secondary" disabled={pull.isPending} onClick={() => pull.mutate(undefined)}>
              {t('connect.pull')}
            </Button>
          </>
        )}
      </div>
      {conn && (
        <p className="text-xs text-muted-foreground">
          {t('connect.channelHook')}{' '}
          <code className="font-mono break-all">{`${window.location.origin}${conn.hookPath}`}</code>
        </p>
      )}
    </Card>
  );
}
