import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { send, useConnectMutation } from './api';

type BillLike = {
  id: string;
  type: string;
  status: string;
  party: { taxId?: string | null } | null;
  einvoice?: { irn: string; cancelledAt?: string | null; canCancel?: boolean } | null;
};

/** On an issued B2B invoice or note: register its e-invoice (IRN), or cancel it while the 24 hours last. */
export function EinvoiceButton({ bill }: { bill: BillLike }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const again = () => void qc.invalidateQueries({ queryKey: ['money'] });
  const make = useConnectMutation(() => send(`/api/money/bills/${bill.id}/einvoice`), t('connect.irnMade'));
  const cancel = useConnectMutation(
    (remark: string) => send(`/api/money/bills/${bill.id}/einvoice/cancel`, { reason: '2', remark }),
    t('connect.irnCancelledNow'),
  );
  const fits =
    ['INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE'].includes(bill.type) &&
    ['ISSUED', 'PART_PAID', 'PAID'].includes(bill.status) &&
    Boolean(bill.party?.taxId);
  if (!fits) return null;
  const e = bill.einvoice;
  if (!e)
    return (
      <Button
        variant="secondary"
        disabled={make.isPending}
        onClick={() => make.mutate(undefined, { onSuccess: again })}
      >
        {t('connect.makeIrn')}
      </Button>
    );
  // The server says whether the 24 hours are still running.
  if (!e.canCancel) return null;
  return (
    <Button
      variant="ghost"
      disabled={cancel.isPending}
      onClick={() => {
        const remark = window.prompt(t('connect.cancelWhy'));
        if (remark && remark.trim().length >= 3) cancel.mutate(remark.trim(), { onSuccess: again });
      }}
    >
      {t('connect.cancelIrn')}
    </Button>
  );
}
