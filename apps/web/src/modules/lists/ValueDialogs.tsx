import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Select } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api';
import { listsApi, titleOf, useListsMutation, type ListInfo, type ListValue } from './api';

/** Add a value to a list, or (with `value`) rename one. */
export function ValueDialog({
  list,
  value,
  onClose,
}: {
  list: ListInfo;
  value?: ListValue;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState(value?.value ?? '');
  const [error, setError] = useState<string>();
  const save = useListsMutation(
    () => (value ? listsApi.change(value.id, { value: text }) : listsApi.add(list.key, text)),
    (r) => t(value ? 'lists.p.renamed' : 'lists.p.added', { value: r.value }),
  );
  const unchanged = !text.trim() || text.trim() === value?.value;
  const submit = () =>
    save.mutate(undefined, {
      onSuccess: onClose,
      onError: (e) => setError(e instanceof ApiError ? e.message : undefined),
    });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={
        value
          ? t('lists.p.renameTitle', { value: value.value })
          : t('lists.p.addTitle', { list: titleOf(list) })
      }
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" disabled={unchanged || save.isPending} onClick={submit}>
            {save.isPending && <Loader2 className="animate-spin" />} {t('common.save')}
          </Button>
        </>
      }
    >
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!unchanged && !save.isPending) submit();
        }}
      >
        <Field label={t('lists.p.value')} error={error}>
          <Input
            autoFocus
            value={text}
            maxLength={300}
            aria-invalid={Boolean(error)}
            onChange={(e) => (setText(e.target.value), setError(undefined))}
          />
        </Field>
        {value && (
          <p className="text-sm text-muted-foreground">{t('lists.p.renameNote', { value: value.value })}</p>
        )}
      </form>
    </Dialog>
  );
}

/** Merge one value into another of the same list: the other keeps both counts, this one leaves the list. */
export function MergeDialog({
  value,
  others,
  onClose,
}: {
  value: ListValue;
  others: ListValue[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [into, setInto] = useState('');
  const merge = useListsMutation(
    () => listsApi.merge(value.id, into),
    (r) => t('lists.p.merged', { value: r.value }),
  );
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('lists.p.mergeTitle', { value: value.value })}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button
            variant="primary"
            disabled={!into || merge.isPending}
            onClick={() => merge.mutate(undefined, { onSuccess: onClose })}
          >
            {merge.isPending && <Loader2 className="animate-spin" />} {t('lists.p.mergeDo')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {others.length ? (
          <Field label={t('lists.p.mergeInto')}>
            <Select value={into} onChange={(e) => setInto(e.target.value)}>
              <option value="">{t('org.choose')}</option>
              {others.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.hidden ? `${o.value} (${t('lists.p.hidden')})` : o.value}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <p className="text-sm">{t('lists.p.mergeNone')}</p>
        )}
        <p className="text-sm text-muted-foreground">{t('lists.p.mergeNote', { value: value.value })}</p>
      </div>
    </Dialog>
  );
}
