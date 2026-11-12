import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  APPROVER_KINDS,
  DEFAULT_APPROVAL_STEPS,
  type ApprovalKind,
  type ApprovalStep,
  type OrgPerson,
} from '@mono/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Field, Select } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { personLabel } from '@/lib/people';
import { put, useOrgMutation } from '../api';
import type { Chain, Route, Structure } from './api';

/** Kinds whose requests carry an amount, so a step can say "from ₹…". */
const WITH_AMOUNT: ApprovalKind[] = ['ims.adjustment'];
const number = (v: string) => (v.trim() === '' || Number.isNaN(Number(v)) ? undefined : Number(v));

type Props = { route: Partial<Route>; structure: Structure; people: OrgPerson[]; onClose: () => void };

/** One ladder: where it applies, its steps in order, and a "who would decide?" check. */
export function RouteDialog({ route, structure, people, onClose }: Props) {
  const { t } = useTranslation();
  const kind = route.kind!;
  const [place, setPlace] = useState(
    route.branchId ? `b:${route.branchId}` : route.entityId ? `e:${route.entityId}` : '',
  );
  const [steps, setSteps] = useState<ApprovalStep[]>(route.steps ?? DEFAULT_APPROVAL_STEPS);
  const active = people.filter((p) => p.status === 'ACTIVE');
  const save = useOrgMutation(
    () =>
      put('/api/branches/approvals', {
        kind,
        branchId: place.startsWith('b:') ? place.slice(2) : null,
        entityId: place.startsWith('e:') ? place.slice(2) : null,
        steps,
      }),
    { success: t('org.saved') },
  );
  const set = (i: number, patch: Partial<ApprovalStep>) =>
    setSteps(steps.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const move = (i: number, by: number) => {
    const next = [...steps];
    const [row] = next.splice(i, 1);
    next.splice(i + by, 0, row!);
    setSteps(next);
  };
  const complete = steps.length > 0 && steps.every((s) => s.who !== 'user' || s.userId);

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('branches.route.title', { kind: t(`branches.kind.${kind}`) })}
      footer={
        <Button
          variant="primary"
          disabled={!complete || save.isPending}
          onClick={() => save.mutate(undefined, { onSuccess: onClose })}
        >
          {t('common.save')}
        </Button>
      }
    >
      <div className="space-y-4">
        <Field label={t('branches.route.place')} hint={t('branches.route.placeHint')}>
          <Select value={place} onChange={(e) => setPlace(e.target.value)} disabled={Boolean(route.id)}>
            <option value="">{t('branches.route.wholeGroup')}</option>
            {structure.entities.map((e) => (
              <option key={e.id} value={`e:${e.id}`}>
                {t('branches.route.entityOnly', { name: e.name })}
              </option>
            ))}
            {structure.branches.map((b) => (
              <option key={b.id} value={`b:${b.id}`}>
                {t('branches.route.branchOnly', { name: b.name })}
              </option>
            ))}
          </Select>
        </Field>

        <ol className="space-y-3">
          {steps.map((s, i) => (
            <li key={i} className="space-y-2 rounded-control border p-3">
              <div className="flex items-center gap-1">
                <span className="tabular flex-1 text-sm font-medium">
                  {t('branches.route.step', { n: i + 1 })}
                </span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('branches.route.moveUp')}
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                >
                  <ArrowUp />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('branches.route.moveDown')}
                  disabled={i === steps.length - 1}
                  onClick={() => move(i, 1)}
                >
                  <ArrowDown />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('common.remove')}
                  disabled={steps.length === 1}
                  onClick={() => setSteps(steps.filter((_, j) => j !== i))}
                >
                  <Trash2 />
                </Button>
              </div>
              <Select
                aria-label={t('branches.route.who')}
                value={s.who}
                onChange={(e) => {
                  const who = e.target.value as ApprovalStep['who'];
                  set(i, { who, userId: who === 'user' ? s.userId : undefined });
                }}
              >
                {APPROVER_KINDS.map((w) => (
                  <option key={w} value={w}>
                    {t(`branches.who.${w}`)}
                  </option>
                ))}
              </Select>
              {s.who === 'user' && (
                <Select
                  aria-label={t('branches.route.person')}
                  value={s.userId ?? ''}
                  onChange={(e) => set(i, { userId: e.target.value || undefined })}
                >
                  <option value="">{t('org.choose')}</option>
                  {active.map((p) => (
                    <option key={p.id} value={p.id}>
                      {personLabel(p)}
                    </option>
                  ))}
                </Select>
              )}
              <div className="grid grid-cols-2 gap-2">
                <Field label={t('branches.route.upAfter')}>
                  <Input
                    inputMode="numeric"
                    value={s.escalateAfterHours ?? ''}
                    placeholder={t('branches.route.never')}
                    onChange={(e) => set(i, { escalateAfterHours: number(e.target.value) })}
                  />
                </Field>
                {WITH_AMOUNT.includes(kind) && (
                  <Field label={t('branches.route.fromAmount')}>
                    <Input
                      inputMode="numeric"
                      value={s.fromAmount ?? ''}
                      placeholder={t('branches.route.anyAmount')}
                      onChange={(e) => set(i, { fromAmount: number(e.target.value) })}
                    />
                  </Field>
                )}
              </div>
              {s.who !== 'owner' && s.who !== 'user' && (
                <label className="flex items-start gap-2 text-sm">
                  <Checkbox
                    className="mt-0.5"
                    checked={Boolean(s.skipIfEmpty)}
                    onChange={(e) => set(i, { skipIfEmpty: e.target.checked || undefined })}
                  />
                  {t('branches.route.skipIfEmpty')}
                </label>
              )}
            </li>
          ))}
        </ol>
        <Button
          variant="secondary"
          size="sm"
          disabled={steps.length >= 6}
          onClick={() => setSteps([...steps, { who: 'owner' }])}
        >
          <Plus /> {t('branches.route.addStep')}
        </Button>
        <p className="text-xs text-muted-foreground">{t('branches.route.rules')}</p>
        {route.id && <Check kind={kind} people={active} withAmount={WITH_AMOUNT.includes(kind)} />}
      </div>
    </Dialog>
  );
}

/** "Who would decide?" for one person's request, read from the saved routes. */
function Check({
  kind,
  people,
  withAmount,
}: {
  kind: ApprovalKind;
  people: OrgPerson[];
  withAmount: boolean;
}) {
  const { t } = useTranslation();
  const [userId, setUserId] = useState('');
  const [amount, setAmount] = useState('');
  const [chain, setChain] = useState<Chain | null>(null);
  const name = new Map(people.map((p) => [p.id, p.name]));
  const run = async (id: string, amt: string) => {
    setUserId(id);
    setAmount(amt);
    if (!id) return setChain(null);
    const q = new URLSearchParams({
      kind,
      userId: id,
      ...(number(amt) !== undefined ? { amount: amt } : {}),
    });
    setChain((await api<{ chain: Chain | null }>(`/api/branches/approvals/preview?${q}`)).chain);
  };
  return (
    <div className="space-y-2 rounded-control bg-muted p-3">
      <div className="text-sm font-medium">{t('branches.route.check')}</div>
      <p className="text-xs text-muted-foreground">{t('branches.route.checkHint')}</p>
      <div className="grid grid-cols-2 gap-2">
        <div className={withAmount ? '' : 'col-span-2'}>
          <Select
            aria-label={t('branches.route.checkPerson')}
            value={userId}
            onChange={(e) => void run(e.target.value, amount)}
          >
            <option value="">{t('branches.route.checkPerson')}</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {personLabel(p)}
              </option>
            ))}
          </Select>
        </div>
        {withAmount && (
          <Input
            inputMode="numeric"
            aria-label={t('branches.route.checkAmount')}
            placeholder={t('branches.route.checkAmount')}
            value={amount}
            onChange={(e) => void run(userId, e.target.value)}
          />
        )}
      </div>
      {chain && (
        <ol className="text-sm">
          {chain.steps.map((s, i) => (
            <li key={i}>
              <span className="tabular mr-1.5 text-muted-foreground">{i + 1}.</span>
              {t(`branches.who.${s.who}`)}:{' '}
              {s.userIds.length
                ? s.userIds.map((id) => name.get(id) ?? '?').join(', ')
                : t('branches.route.nobody')}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
