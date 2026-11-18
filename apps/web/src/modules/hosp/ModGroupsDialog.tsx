import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { rupees } from '@/modules/stock/api';
import { send, useHospMutation, type MenuSetup, type ModGroup } from './api';

const keyOf = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 30) || 'o';

/** Add-on groups ("Extras", "Choice of bread"): how many a guest must and may pick, and each option's price. */
export function ModGroupsDialog({ setup, onClose }: { setup: MenuSetup; onClose: () => void }) {
  const { t } = useTranslation();
  const [edit, setEdit] = useState<Partial<ModGroup> | null>(null);
  if (edit) return <GroupForm group={edit} onClose={() => setEdit(null)} />;
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('hosp.addons.title')}
      description={t('hosp.addons.hint')}
      footer={
        <Button variant="primary" onClick={() => setEdit({})}>
          <Plus /> {t('hosp.addons.add')}
        </Button>
      }
    >
      {setup.groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('hosp.addons.none')}</p>
      ) : (
        <ul className="divide-y">
          {setup.groups.map((g) => (
            <li key={g.id}>
              <button type="button" className="w-full py-2.5 text-left" onClick={() => setEdit(g)}>
                <div className="font-medium">
                  {g.name}{' '}
                  <span className="text-xs font-normal text-muted-foreground">
                    · {t('hosp.addons.pick', { min: g.min, max: g.max })}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {g.options.map((o) => (o.price ? `${o.name} +${rupees(o.price)}` : o.name)).join(' · ')}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

function GroupForm({ group, onClose }: { group: Partial<ModGroup>; onClose: () => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState(group.name ?? '');
  const [min, setMin] = useState(String(group.min ?? 0));
  const [max, setMax] = useState(String(group.max ?? 1));
  const [options, setOptions] = useState(
    (group.options ?? [{ key: '', name: '', price: 0 }]).map((o) => ({
      ...o,
      price: o.price ? String(o.price / 100) : '',
    })),
  );
  const kept = options.filter((o) => o.name.trim());
  const body = {
    name,
    min: Number(min) || 0,
    max: Math.max(1, Number(max) || 1),
    // An option keeps its key and its stock effect; only the name and price are typed here.
    options: kept.map((o) => ({
      ...o,
      key: o.key || keyOf(o.name),
      price: Math.round(Number(o.price || 0) * 100),
    })),
  };
  const save = useHospMutation(
    () =>
      group.id
        ? send('PUT', `/api/hosp/menu/groups/${group.id}`, body)
        : send('POST', '/api/hosp/menu/groups', body),
    t('org.saved'),
  );
  const drop = useHospMutation(() => send('DELETE', `/api/hosp/menu/groups/${group.id}`), t('org.deleted'));
  const set = (i: number, patch: Partial<(typeof options)[number]>) =>
    setOptions(options.map((o, j) => (j === i ? { ...o, ...patch } : o)));
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={group.id ? (group.name ?? '') : t('hosp.addons.add')}
      footer={
        <>
          {group.id && (
            <Button
              variant="ghost"
              disabled={drop.isPending}
              onClick={() => drop.mutate(undefined, { onSuccess: onClose })}
            >
              {t('org.delete')}
            </Button>
          )}
          <Button
            variant="primary"
            disabled={!name.trim() || !kept.length || body.min > body.max || save.isPending}
            onClick={() => save.mutate(undefined, { onSuccess: onClose })}
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('org.name')} className="col-span-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <Field label={t('hosp.addons.min')} hint={t('hosp.addons.minHint')}>
          <Input inputMode="numeric" value={min} onChange={(e) => setMin(e.target.value)} />
        </Field>
        <Field label={t('hosp.addons.max')}>
          <Input inputMode="numeric" value={max} onChange={(e) => setMax(e.target.value)} />
        </Field>
      </div>
      <div className="mt-4 space-y-2">
        <div className="text-sm font-medium">{t('hosp.addons.options')}</div>
        {options.map((o, i) => (
          <div key={i} className="grid grid-cols-[minmax(0,1fr)_96px_auto] gap-2">
            <Input
              aria-label={t('hosp.addons.option')}
              placeholder={t('hosp.addons.option')}
              value={o.name}
              onChange={(e) => set(i, { name: e.target.value })}
            />
            <Input
              aria-label={t('hosp.addons.extra')}
              placeholder={t('hosp.addons.extra')}
              inputMode="decimal"
              value={o.price}
              onChange={(e) => set(i, { price: e.target.value })}
            />
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t('common.remove')}
              onClick={() => setOptions(options.filter((_, j) => j !== i))}
            >
              <Trash2 />
            </Button>
          </div>
        ))}
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setOptions([...options, { key: '', name: '', price: '' }])}
        >
          <Plus /> {t('hosp.addons.addOption')}
        </Button>
      </div>
    </Dialog>
  );
}
