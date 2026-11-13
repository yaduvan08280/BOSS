import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, Select } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { CopyButton } from '@/modules/system/apikeys/SecretOnce';
import { send, useConnectMutation, when, type Connection } from './api';

const KEYS = {
  RAZORPAY: ['keyId', 'keySecret', 'webhookSecret'],
  CASHFREE: ['clientId', 'clientSecret'],
} as const;

/** How a connection is doing: saved or not, the last time it worked, the last thing that went wrong. */
export function ConnState({ c }: { c: Connection | undefined }) {
  const { t } = useTranslation();
  if (!c) return <p className="text-xs text-muted-foreground">{t('connect.notConnected')}</p>;
  return (
    <p className="text-xs text-muted-foreground">
      {t('connect.keysSaved')} · {t('connect.lastOk', { at: when(c.lastOkAt) })}
      {c.lastError ? <span className="text-status-bad-fg"> · {c.lastError}</span> : null}
    </p>
  );
}

/** The company's payment gateway: provider, keys (never shown again), and the address its webhook must call. */
export function GatewayCard({ connection, canAdmin }: { connection?: Connection; canAdmin: boolean }) {
  const { t } = useTranslation();
  const [provider, setProvider] = useState<keyof typeof KEYS>(
    (connection?.provider as keyof typeof KEYS) ?? 'RAZORPAY',
  );
  const [keys, setKeys] = useState<Record<string, string>>({});
  const filled = Object.values(keys).some(Boolean);
  const save = useConnectMutation(
    () =>
      send(
        '/api/connect/connections',
        { kind: 'GATEWAY', provider, ...(filled ? { secret: keys } : {}) },
        'PUT',
      ),
    t('connect.saved'),
  );
  const hook = connection ? `${window.location.origin}${connection.hookPath}` : null;
  return (
    <Card className="space-y-3 p-4" data-testid="gateway-card">
      <div>
        <h3 className="font-semibold">{t('connect.gateway')}</h3>
        <p className="text-xs text-muted-foreground">{t('connect.gatewayHint')}</p>
      </div>
      <ConnState c={connection} />
      <Field label={t('connect.provider')}>
        <Select
          aria-label={t('connect.provider')}
          value={provider}
          disabled={!canAdmin}
          onChange={(e) => {
            setProvider(e.target.value as keyof typeof KEYS);
            setKeys({});
          }}
        >
          <option value="RAZORPAY">Razorpay</option>
          <option value="CASHFREE">Cashfree</option>
        </Select>
      </Field>
      {KEYS[provider].map((k) => (
        <Field key={k} label={t(`connect.key.${k}`)}>
          <Input
            type="password"
            autoComplete="off"
            disabled={!canAdmin}
            placeholder={connection?.provider === provider ? t('connect.keepKey') : ''}
            value={keys[k] ?? ''}
            onChange={(e) => setKeys((x) => ({ ...x, [k]: e.target.value }))}
          />
        </Field>
      ))}
      {hook && (
        <div>
          <div className="text-xs text-muted-foreground">{t('connect.webhook')}</div>
          <div className="flex items-center gap-2 rounded-control border bg-muted/50 p-2">
            <code className="min-w-0 flex-1 font-mono text-xs break-all" data-testid="gateway-hook">
              {hook}
            </code>
            <CopyButton value={hook} />
          </div>
        </div>
      )}
      {canAdmin && (
        <Button
          disabled={save.isPending || (!filled && connection?.provider !== provider)}
          onClick={() => save.mutate(undefined)}
        >
          {t('connect.save')}
        </Button>
      )}
    </Card>
  );
}

/** The e-invoice provider (GSP): its address and token. */
export function EinvoiceCard({ connection, canAdmin }: { connection?: Connection; canAdmin: boolean }) {
  const { t } = useTranslation();
  const [baseUrl, setBaseUrl] = useState(connection?.baseUrl ?? '');
  const [token, setToken] = useState('');
  const save = useConnectMutation(
    () =>
      send(
        '/api/connect/connections',
        { kind: 'EINVOICE', provider: 'GSP', baseUrl, ...(token ? { secret: { token } } : {}) },
        'PUT',
      ),
    t('connect.saved'),
  );
  return (
    <Card className="space-y-3 p-4" data-testid="einvoice-card">
      <div>
        <h3 className="font-semibold">{t('connect.einvoice')}</h3>
        <p className="text-xs text-muted-foreground">{t('connect.einvoiceHint')}</p>
      </div>
      <ConnState c={connection} />
      <Field label={t('connect.address')}>
        <Input
          inputMode="url"
          disabled={!canAdmin}
          placeholder="https://"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
        />
      </Field>
      <Field label={t('connect.key.token')}>
        <Input
          type="password"
          autoComplete="off"
          disabled={!canAdmin}
          placeholder={connection ? t('connect.keepKey') : ''}
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
      </Field>
      {canAdmin && (
        <Button
          disabled={save.isPending || !baseUrl || (!connection && !token)}
          onClick={() => save.mutate(undefined)}
        >
          {t('connect.save')}
        </Button>
      )}
    </Card>
  );
}
