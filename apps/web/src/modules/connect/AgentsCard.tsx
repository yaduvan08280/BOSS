import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { hasPermission, type Me } from '@mono/shared';
import { StatusChip } from '@/components/status-chip';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, Select } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { useBranches } from '@/modules/system/api';
import { SecretOnce } from '@/modules/system/apikeys/SecretOnce';
import { dmy, send, useConnectMutation, useTallyQueue, when, type Health } from './api';

/** Site agents (the small program at a branch that prints and posts to Tally) and where Tally posting stands. */
export function AgentsCard({ health, canAdmin, me }: { health: Health; canAdmin: boolean; me: Me }) {
  const { t } = useTranslation();
  const branches = useBranches();
  const accounts = hasPermission(me.user.permissions, 'money.admin');
  const tally = useTallyQueue(accounts);
  const [branchId, setBranchId] = useState('');
  const [name, setName] = useState('');
  const [key, setKey] = useState<string | null>(null);
  const add = useConnectMutation(
    () => send<{ key: string }>('/api/connect/agents', { branchId, name }),
    (r) => {
      setKey(r.key);
      setName('');
      return undefined;
    },
  );
  const revoke = useConnectMutation(
    (id: string) => send(`/api/connect/agents/${id}`, undefined, 'DELETE'),
    t('connect.revoked'),
  );
  const retry = useConnectMutation(
    () => send<{ again: number }>('/api/connect/tally/retry'),
    (r) => t('connect.tallyAgain', { count: r.again }),
  );
  const branchName = (id: string) => branches.data?.find((b) => b.id === id)?.name ?? '…';
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="space-y-3 p-4" data-testid="agents-card">
        <div>
          <h3 className="font-semibold">{t('connect.agents')}</h3>
          <p className="text-xs text-muted-foreground">{t('connect.agentsHint')}</p>
        </div>
        <ul className="space-y-2">
          {health.agents.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <div className="min-w-0">
                <div className="font-medium">{a.name}</div>
                <div className="text-xs text-muted-foreground">
                  {branchName(a.branchId)} · {t('connect.lastSeen', { at: when(a.lastSeenAt) })}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <StatusChip tone={a.online ? 'ok' : 'bad'}>
                  {a.online ? t('connect.online') : t('connect.offline')}
                </StatusChip>
                {canAdmin && (
                  <Button
                    size="sm"
                    variant="secondary"
                    aria-label={t('connect.revokeNamed', { name: a.name })}
                    onClick={() => {
                      if (window.confirm(t('connect.revokeAsk', { name: a.name }))) revoke.mutate(a.id);
                    }}
                  >
                    {t('connect.revoke')}
                  </Button>
                )}
              </div>
            </li>
          ))}
          {health.agents.length === 0 && (
            <li className="text-sm text-muted-foreground">{t('connect.noAgents')}</li>
          )}
        </ul>
        {canAdmin && (
          <div className="grid gap-3 border-t pt-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <Field label={t('connect.branch')}>
              <Select
                aria-label={t('connect.branch')}
                value={branchId}
                onChange={(e) => setBranchId(e.target.value)}
              >
                <option value="">—</option>
                {(branches.data ?? []).map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('connect.agentName')}>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Button
              disabled={!branchId || !name.trim() || add.isPending}
              onClick={() => add.mutate(undefined)}
            >
              {t('connect.addAgent')}
            </Button>
          </div>
        )}
      </Card>
      <Card className="space-y-3 p-4" data-testid="tally-card">
        <div>
          <h3 className="font-semibold">{t('connect.tallyTitle')}</h3>
          <p className="text-xs text-muted-foreground">{t('connect.tallyHint')}</p>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center text-sm">
          <div className="rounded-control border p-2">
            <div className="text-lg font-semibold tabular">{tally.data?.waiting ?? health.tally.waiting}</div>
            {t('connect.waiting')}
          </div>
          <div className="rounded-control border p-2">
            <div className="text-lg font-semibold tabular">{tally.data?.posted ?? '—'}</div>
            {t('connect.posted')}
          </div>
          <div className="rounded-control border p-2">
            <div className="text-lg font-semibold tabular">
              {tally.data?.failed.length ?? health.tally.failed}
            </div>
            {t('connect.failed')}
          </div>
        </div>
        {(tally.data?.failed ?? []).map((v) => (
          <div key={v.id} className="text-xs">
            <span className="font-mono">{v.narration}</span> · {dmy(v.date)} ·{' '}
            <span className="text-status-bad-fg">{v.error}</span>
          </div>
        ))}
        {accounts && (tally.data?.failed.length ?? 0) > 0 && (
          <Button variant="secondary" disabled={retry.isPending} onClick={() => retry.mutate(undefined)}>
            {t('connect.sendAgain')}
          </Button>
        )}
      </Card>
      {key && <SecretOnce title={t('connect.agentKey')} value={key} onClose={() => setKey(null)} />}
    </div>
  );
}
