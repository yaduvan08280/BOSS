import { useTranslation } from 'react-i18next';
import type { PayPurpose } from '@mono/shared';
import { Button } from '@/components/ui/button';
import { rupees } from '@/modules/stock/api';
import { CopyButton } from '@/modules/system/apikeys/SecretOnce';
import { send, useConnectMutation, usePayLinks, type PayLink } from './api';

/**
 * "Send a payment link" for a deposit, an advance or a bill: makes the link at the company's gateway and shows
 * it to copy or open. The money is recorded by the gateway's webhook, not here.
 */
export function PayLinkButton({
  purpose,
  refId,
  amount,
}: {
  purpose: PayPurpose;
  refId: string;
  amount?: number;
}) {
  const { t } = useTranslation();
  const links = usePayLinks(purpose, refId, true);
  const make = useConnectMutation(
    () => send<PayLink>('/api/connect/paylinks', { purpose, refId, ...(amount ? { amount } : {}) }),
    t('connect.linkMade'),
  );
  const waiting = links.data?.find((l) => l.status === 'CREATED' && l.url);
  return (
    <div className="space-y-2" data-testid="pay-link">
      <Button
        variant="secondary"
        size="sm"
        disabled={make.isPending || (purpose !== 'RESERVATION_DEPOSIT' && purpose !== 'POS_CHECK' && !amount)}
        onClick={() => make.mutate(undefined)}
      >
        {t('connect.payLink')}
      </Button>
      {waiting && (
        <div className="flex items-center gap-2 rounded-control border bg-muted/50 p-2">
          <a
            className="min-w-0 flex-1 font-mono text-xs break-all underline"
            href={waiting.url!}
            target="_blank"
            rel="noreferrer"
          >
            {waiting.url}
          </a>
          <span className="text-xs tabular">{rupees(waiting.amount)}</span>
          <CopyButton value={waiting.url!} />
        </div>
      )}
      {waiting?.note && <p className="text-xs text-status-bad-fg">{waiting.note}</p>}
    </div>
  );
}
