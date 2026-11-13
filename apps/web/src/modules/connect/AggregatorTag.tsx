import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { send, useConnectMutation } from './api';

const NAMES: Record<string, string> = { ZOMATO: 'Zomato', SWIGGY: 'Swiggy' };

/** A takeaway / delivery order that came through Zomato or Swiggy: its number there, so the bill is theirs to pay. */
export function AggregatorTag({
  order,
  canTag,
}: {
  order: { id: string; aggregator?: string | null; aggregatorRef?: string | null };
  canTag: boolean;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [aggregator, setAggregator] = useState('ZOMATO');
  const [ref, setRef] = useState('');
  const tag = useConnectMutation(
    () => send(`/api/pos/orders/${order.id}/aggregator`, { aggregator, ref: ref.trim() }),
    t('connect.tagged'),
  );
  if (order.aggregator)
    return (
      <p className="text-sm" data-testid="aggregator-tag">
        {t('connect.taggedAs', {
          name: NAMES[order.aggregator] ?? t('connect.otherPartner'),
          ref: order.aggregatorRef,
        })}
      </p>
    );
  if (!canTag) return null;
  return (
    <div className="flex flex-wrap items-end gap-2 rounded-control bg-muted p-2" data-testid="aggregator-tag">
      <div className="w-32">
        <Select
          aria-label={t('connect.aggregator')}
          value={aggregator}
          onChange={(e) => setAggregator(e.target.value)}
        >
          <option value="ZOMATO">Zomato</option>
          <option value="SWIGGY">Swiggy</option>
          <option value="OTHER">{t('connect.otherPartner')}</option>
        </Select>
      </div>
      <div className="w-40">
        <Input
          aria-label={t('connect.aggregatorRef')}
          placeholder={t('connect.aggregatorRef')}
          value={ref}
          onChange={(e) => setRef(e.target.value)}
        />
      </div>
      <Button
        size="sm"
        variant="secondary"
        disabled={!ref.trim() || tag.isPending}
        onClick={() =>
          tag.mutate(undefined, { onSuccess: () => void qc.invalidateQueries({ queryKey: ['pos'] }) })
        }
      >
        {t('connect.tag')}
      </Button>
    </div>
  );
}
