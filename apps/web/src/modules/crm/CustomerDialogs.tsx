import { FileUp, Loader2, Pencil, Plus, ShoppingBag, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  addDays,
  formatLocalDate,
  hasPermission,
  localDate,
  SEGMENTS,
  type CrmConfig,
  type Me,
} from '@mono/shared';
import { PageSkeleton } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Field, Select, Switch, Textarea } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { InfoRow } from '@/components/work';
import { personLabel } from '@/lib/people';
import { useUsers } from '@/modules/system/api';
import { crmApi, inr, useCrmMutation, useCustomer, type CustomerRow } from './api';
import { emptyOrder, orderBody } from './order';
import { OrderForm } from './OrderForm';
import { TagChips } from './tags';

/** A customer's card: their numbers, SCOT rhythm, what they buy, 12 months of orders, own tags, a new order. */
export function CustomerSheet({
  id,
  me,
  defs,
  onEdit,
  onClose,
}: {
  id: string;
  me: Me;
  defs: CrmConfig['tags'];
  onEdit: (c: CustomerRow) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const q = useCustomer(id);
  const [ordering, setOrdering] = useState(false);
  const tags = useCrmMutation(
    (tags: string[]) => crmApi.setTags(id, tags),
    () => t('crm.s.saved'),
  );
  const c = q.data;
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      wide
      title={c?.name ?? '…'}
      description={c ? [c.code, c.city, c.mobile].filter(Boolean).join(' · ') : undefined}
      footer={
        c && (
          <>
            {hasPermission(me.user.permissions, 'crm.edit') && (
              <Button variant="secondary" onClick={() => onEdit(c)}>
                <Pencil /> {t('common.edit')}
              </Button>
            )}
            {hasPermission(me.user.permissions, 'crm.create') && (
              <Button onClick={() => setOrdering(true)}>
                <ShoppingBag /> {t('crm.o.new')}
              </Button>
            )}
          </>
        )
      }
    >
      {!c ? (
        <PageSkeleton />
      ) : (
        <div className="space-y-4 text-sm">
          <TagChips auto={c.autoTags} own={c.tags} defs={defs} />
          <div className="grid gap-x-6 sm:grid-cols-2">
            <InfoRow label={t('crm.c.sales12')}>
              {inr(c.sales12)} · {t('crm.c.orders', { count: c.orders12 })}
            </InfoRow>
            <InfoRow label={t('crm.c.gp12')}>
              {inr(c.gp12)}
              {c.marginPct !== null && ` · ${c.marginPct}%`}
            </InfoRow>
            <InfoRow label={t('crm.c.owes')}>
              {inr(c.receivable)}
              {Number(c.overdue) > 0 && ` · ${t('crm.c.overdue', { amount: inr(c.overdue) })}`}
            </InfoRow>
            <InfoRow label={t('crm.c.handledBy')}>
              {c.handledBy ?? '—'} · {t('crm.c.creditDays', { count: c.creditDays })}
            </InfoRow>
          </div>
          {c.scot.onScot && (
            <p className="rounded-control bg-muted/40 px-3 py-2">
              {t('crm.c.scotLine', {
                average: inr(c.scot.averageOrder, true),
                every: c.scot.everyDays,
                due: c.scot.nextDue ? formatLocalDate(c.scot.nextDue) : '—',
                call: c.scot.callOn ? formatLocalDate(c.scot.callOn) : '—',
              })}
              {c.scot.topItems.length > 0 && ` · ${c.scot.topItems.join(', ')}`}
            </p>
          )}
          {defs.length > 0 && hasPermission(me.user.permissions, 'crm.edit') && (
            <div className="flex flex-wrap gap-3">
              {defs.map((d) => (
                <label key={d.key} className="flex items-center gap-1.5">
                  <Checkbox
                    checked={c.tags.includes(d.key)}
                    disabled={tags.isPending}
                    onChange={(e) =>
                      tags.mutate(e.target.checked ? [...c.tags, d.key] : c.tags.filter((x) => x !== d.key))
                    }
                  />{' '}
                  {d.name}
                </label>
              ))}
            </div>
          )}
          <div>
            <div className="mb-1 font-medium">{t('crm.c.history')}</div>
            {!c.orders.length ? (
              <p className="text-muted-foreground">{t('crm.c.noOrders')}</p>
            ) : (
              <ul className="divide-y rounded-control border">
                {c.orders.map((o) => (
                  <li key={o.id} className="flex flex-wrap justify-between gap-2 px-3 py-2">
                    <span>
                      <span className="font-mono text-xs">{o.number}</span> · {formatLocalDate(o.date)}
                      {Array.isArray(o.items) && o.items.length > 0 && (
                        <span className="text-muted-foreground">
                          {' '}
                          · {o.items.map((i) => i.item).join(', ')}
                        </span>
                      )}
                    </span>
                    <b className="tabular-nums">{inr(o.amount)}</b>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
      {ordering && c && <NewOrder customer={c} tz={me.company.timezone} onClose={() => setOrdering(false)} />}
    </Dialog>
  );
}

function NewOrder({ customer, tz, onClose }: { customer: CustomerRow; tz: string; onClose: () => void }) {
  const { t } = useTranslation();
  const [o, setO] = useState(emptyOrder(addDays(localDate(new Date(), tz), 3)));
  const body = orderBody(o);
  const save = useCrmMutation(
    () => crmApi.order({ ...body!, customerId: customer.id }),
    (r) => t('crm.o.taken', { number: r.number }),
  );
  return (
    <Dialog
      open
      onOpenChange={(x) => !x && onClose()}
      title={t('crm.o.newFor', { name: customer.name })}
      footer={
        <Button
          disabled={!body || save.isPending}
          onClick={() => save.mutate(undefined, { onSuccess: onClose })}
        >
          {save.isPending && <Loader2 className="animate-spin" />} {t('crm.o.save')}
        </Button>
      }
    >
      <OrderForm value={o} onChange={setO} />
    </Dialog>
  );
}

/** Add or change a customer. */
export function CustomerDialog({
  customer: c,
  onClose,
}: {
  customer: CustomerRow | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const users = useUsers();
  const [v, setV] = useState({
    name: c?.name ?? '',
    city: c?.city ?? '',
    mobile: c?.mobile ?? '',
    email: c?.email ?? '',
    segment: c?.segment ?? '',
    handledById: c?.handledById ?? '',
    creditDays: String(c?.creditDays ?? 30),
    ownerCustomer: c?.ownerCustomer ?? false,
  });
  const save = useCrmMutation(
    () =>
      crmApi.saveCustomer(
        {
          ...v,
          segment: v.segment || null,
          handledById: v.handledById || null,
          creditDays: Math.max(0, Math.min(365, Number(v.creditDays) || 0)),
          city: v.city || null,
          fields: c?.fields ?? {},
        },
        c?.id,
      ),
    (r) => t('crm.c.saved', { name: r.name }),
  );
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) =>
    setV({ ...v, [k]: e.target.value });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={c ? c.name : t('crm.c.add')}
      footer={
        <Button
          disabled={v.name.trim().length < 2 || save.isPending}
          onClick={() => save.mutate(undefined, { onSuccess: onClose })}
        >
          {save.isPending && <Loader2 className="animate-spin" />} {t('common.save')}
        </Button>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('crm.c.name')}>
          <Input value={v.name} onChange={set('name')} />
        </Field>
        <Field label={t('crm.c.city')}>
          <Input value={v.city} onChange={set('city')} />
        </Field>
        <Field label={t('crm.c.mobile')}>
          <Input inputMode="tel" value={v.mobile} onChange={set('mobile')} />
        </Field>
        <Field label={t('crm.c.email')}>
          <Input inputMode="email" value={v.email} onChange={set('email')} />
        </Field>
        <Field label={t('crm.c.segment')}>
          <Select value={v.segment} onChange={set('segment')} aria-label={t('crm.c.segment')}>
            <option value="">—</option>
            {SEGMENTS.map((s) => (
              <option key={s} value={s}>
                {t(`crm.segment.${s}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('crm.c.handledBy')}>
          <Select value={v.handledById} onChange={set('handledById')} aria-label={t('crm.c.handledBy')}>
            <option value="">—</option>
            {(users.data ?? [])
              .filter((u) => u.status === 'ACTIVE')
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {personLabel(u)}
                </option>
              ))}
          </Select>
        </Field>
        <Field label={t('crm.c.creditDaysLabel')}>
          <Input inputMode="numeric" value={v.creditDays} onChange={set('creditDays')} className="w-24" />
        </Field>
        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          <Switch
            checked={v.ownerCustomer}
            onCheckedChange={(ownerCustomer) => setV({ ...v, ownerCustomer })}
          />{' '}
          {t('crm.c.ownerCustomer')}
        </label>
      </div>
    </Dialog>
  );
}

/** Paste a list or open a CSV: Name, City, Mobile, Email, Segment, Credit days. */
export function ImportCustomers({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const save = useCrmMutation(
    () => crmApi.importCustomers(text),
    (r) => t('crm.c.imported', { count: r.created }),
  );
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={t('crm.c.import')}
      description={t('crm.c.importHint')}
      wide
      footer={
        <Button
          disabled={!text.trim() || save.isPending}
          onClick={() => save.mutate(undefined, { onSuccess: () => (setText(''), onClose()) })}
        >
          {save.isPending && <Loader2 className="animate-spin" />} {t('crm.c.import')}
        </Button>
      }
    >
      <div className="space-y-3">
        <Button variant="secondary" onClick={() => file.current?.click()}>
          <FileUp /> {t('task.openFile')}
        </Button>
        <input
          ref={file}
          type="file"
          accept=".csv,.tsv,.txt"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) setText(await f.text());
          }}
        />
        <Textarea
          rows={8}
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label={t('crm.c.import')}
          placeholder={
            'Name\tCity\tMobile\tEmail\tSegment\tCredit days\nShree Tiles\tAjmer\t9829012345\t\tdealer\t30'
          }
        />
      </div>
    </Dialog>
  );
}

/** Fields & tags: what the automatic tags mean (from the customer rules) and your own tags (name + colour). */
export function TagsDialog({ config, onClose }: { config: CrmConfig; onClose: () => void }) {
  const { t } = useTranslation();
  const [tags, setTags] = useState(config.tags);
  const save = useCrmMutation(
    () => crmApi.saveTagDefs(tags),
    () => t('crm.s.saved'),
  );
  const r = config.customers;
  const keyOf = (name: string) =>
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 30) || `tag_${tags.length + 1}`;
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('crm.c.fieldsTags')}
      wide
      footer={
        <Button
          disabled={save.isPending || tags.some((x) => !x.name.trim())}
          onClick={() => save.mutate(undefined, { onSuccess: onClose })}
        >
          {save.isPending && <Loader2 className="animate-spin" />} {t('common.save')}
        </Button>
      }
    >
      <div className="space-y-4 text-sm">
        <ul className="space-y-1.5">
          {(['top20', 'bottom20', 'new', 'sleeping', 'lost', 'vampire', 'owners'] as const).map((k) => (
            <li key={k}>
              <b>{t(`crm.tag.${k}`)}</b> —{' '}
              {t(`crm.tagRule.${k}`, {
                orders: r.newOrders,
                newDays: r.newDays,
                sleeping: r.sleepingDays,
                lost: r.lostDays,
              })}
              {k === 'vampire' && !r.vampire && ` (${t('crm.c.off')})`}
            </li>
          ))}
        </ul>
        <div className="space-y-2">
          <div className="font-medium">{t('crm.c.ownTags')}</div>
          {tags.map((x, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="color"
                aria-label={t('crm.c.tagColour', { name: x.name })}
                value={x.color}
                onChange={(e) => setTags(tags.map((y, k) => (k === i ? { ...y, color: e.target.value } : y)))}
                className="size-9 rounded-control border bg-card"
              />
              <Input
                aria-label={t('crm.c.tagName')}
                value={x.name}
                onChange={(e) => setTags(tags.map((y, k) => (k === i ? { ...y, name: e.target.value } : y)))}
                className="max-w-xs"
              />
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={t('common.remove')}
                onClick={() => setTags(tags.filter((_, k) => k !== i))}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
          <Button
            size="sm"
            variant="secondary"
            disabled={tags.length >= 30}
            onClick={() =>
              setTags([
                ...tags,
                {
                  key: keyOf(`${t('crm.c.newTag')} ${tags.length + 1}`),
                  name: `${t('crm.c.newTag')} ${tags.length + 1}`,
                  color: '#64748b',
                },
              ])
            }
          >
            <Plus /> {t('crm.c.addTag')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
