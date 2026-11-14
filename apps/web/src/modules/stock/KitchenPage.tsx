import { ChefHat, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatLocalDate, hasPermission, type Me } from '@mono/shared';
import { EmptyState, ErrorState, PageHeader, PageSkeleton } from '@/components/page';
import { StatusChip } from '@/components/status-chip';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
  post,
  put,
  qty,
  rupees,
  useItems,
  useProduction,
  useRecipes,
  useStock,
  useStockMutation,
  type Production,
  type Recipe,
} from './api';
import { ItemSelect, PlaceSelect, Seg } from './ui';

/** Recipes and production (phase 13): what a dish or a made item takes, what it costs, and making it in the kitchen. */
export function KitchenPage({ me }: { me: Me }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'recipes' | 'production'>('recipes');
  const [edit, setEdit] = useState<Partial<Recipe> | null>(null);
  const [plan, setPlan] = useState(false);
  const canEdit = hasPermission(me.user.permissions, 'ims.edit');
  return (
    <div>
      <PageHeader
        title={t('stock.kitchen.title')}
        subtitle={t('stock.kitchen.subtitle')}
        actions={
          tab === 'recipes'
            ? canEdit && (
                <Button variant="primary" onClick={() => setEdit({})}>
                  <Plus /> {t('stock.kitchen.newRecipe')}
                </Button>
              )
            : hasPermission(me.user.permissions, 'ims.create') && (
                <Button variant="primary" onClick={() => setPlan(true)}>
                  <Plus /> {t('stock.kitchen.plan')}
                </Button>
              )
        }
      />
      <Seg
        value={tab}
        onChange={setTab}
        options={[
          { key: 'recipes', label: t('stock.kitchen.recipes') },
          { key: 'production', label: t('stock.kitchen.production') },
        ]}
      />
      {tab === 'recipes' ? <Recipes onEdit={canEdit ? setEdit : undefined} /> : <Orders />}
      {edit && <RecipeDialog recipe={edit} onClose={() => setEdit(null)} />}
      {plan && <PlanDialog onClose={() => setPlan(false)} />}
    </div>
  );
}

function Recipes({ onEdit }: { onEdit?: (r: Recipe) => void }) {
  const { t } = useTranslation();
  const q = useRecipes();
  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} error={q.error} />;
  if (!q.data.length)
    return (
      <EmptyState
        icon={ChefHat}
        title={t('stock.kitchen.noRecipes')}
        body={t('stock.kitchen.noRecipesBody')}
      />
    );
  return (
    <ul className="space-y-2">
      {q.data.map((r) => (
        <li key={r.id}>
          <Card>
            <button
              type="button"
              disabled={!onEdit}
              onClick={() => onEdit?.(r)}
              className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 p-3 text-left"
            >
              <div className="min-w-0 flex-1 basis-48">
                <div className="truncate font-medium">{r.name}</div>
                <div className="text-xs text-muted-foreground">
                  v{r.version} · {t('stock.kitchen.makes', { qty: `${qty(r.outputQty)} ${r.unit}` })} ·{' '}
                  {r.lines.map((l) => l.name).join(', ')}
                </div>
              </div>
              <div className="text-right">
                <div className="tabular font-semibold">{r.cost === null ? '—' : rupees(r.cost)}</div>
                {r.foodCostPct !== null && (
                  <div className="tabular text-xs text-muted-foreground">
                    {t('stock.kitchen.foodCost', { pct: r.foodCostPct, price: rupees(r.sellPrice ?? 0) })}
                  </div>
                )}
              </div>
            </button>
          </Card>
        </li>
      ))}
    </ul>
  );
}

type Line = { itemId: string; qty: string; unit: string; yieldPct: string; wastagePct: string };
function RecipeDialog({ recipe, onClose }: { recipe: Partial<Recipe>; onClose: () => void }) {
  const { t } = useTranslation();
  const items = useItems();
  const all = (items.data?.items ?? []).filter((i) => i.active);
  const [itemId, setItemId] = useState(recipe.itemId ?? '');
  const [output, setOutput] = useState(String(recipe.outputQty ?? 1));
  const [lines, setLines] = useState<Line[]>(
    recipe.lines?.length
      ? recipe.lines.map((l) => ({
          itemId: l.itemId,
          qty: String(l.qty),
          unit: l.unit ?? '',
          yieldPct: String(l.yieldPct),
          wastagePct: String(l.wastagePct),
        }))
      : [{ itemId: '', qty: '', unit: '', yieldPct: '100', wastagePct: '0' }],
  );
  const kept = lines.filter((l) => l.itemId && Number(l.qty) > 0);
  const save = useStockMutation(
    () =>
      put('/api/ims/recipes', {
        itemId,
        outputQty: Number(output) || 1,
        lines: kept.map((l) => ({
          itemId: l.itemId,
          qty: Number(l.qty),
          unit: l.unit || null,
          yieldPct: Number(l.yieldPct) || 100,
          wastagePct: Number(l.wastagePct) || 0,
        })),
      }),
    t('stock.kitchen.recipeSaved'),
  );
  const set = (i: number, patch: Partial<Line>) =>
    setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return (
    <Dialog
      open
      wide
      onOpenChange={(o) => !o && onClose()}
      title={recipe.id ? t('stock.kitchen.recipeOf', { name: recipe.name }) : t('stock.kitchen.newRecipe')}
      description={recipe.id ? t('stock.kitchen.newVersion') : t('stock.kitchen.recipeHint')}
      footer={
        <Button
          variant="primary"
          disabled={!itemId || !kept.length || save.isPending}
          onClick={() => save.mutate(undefined, { onSuccess: onClose })}
        >
          {t('common.save')}
        </Button>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_160px]">
        <Field label={t('stock.kitchen.makesItem')}>
          <ItemSelect label={t('stock.kitchen.makesItem')} value={itemId} items={all} onChange={setItemId} />
        </Field>
        <Field label={t('stock.kitchen.output')}>
          <Input inputMode="decimal" value={output} onChange={(e) => setOutput(e.target.value)} />
        </Field>
      </div>
      <div className="mt-4 space-y-3">
        <div className="text-sm font-medium">{t('stock.kitchen.ingredients')}</div>
        {lines.map((l, i) => (
          <div key={i} className="rounded-control border p-2">
            <div className="flex gap-2">
              <div className="min-w-0 flex-1">
                <ItemSelect
                  label={t('stock.kitchen.ingredient')}
                  value={l.itemId}
                  items={all.filter((x) => x.id !== itemId)}
                  onChange={(v) => set(i, { itemId: v })}
                />
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t('common.remove')}
                onClick={() => setLines(lines.filter((_, j) => j !== i))}
              >
                <Trash2 />
              </Button>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Input
                aria-label={t('stock.qty')}
                placeholder={t('stock.qty')}
                inputMode="decimal"
                value={l.qty}
                onChange={(e) => set(i, { qty: e.target.value })}
              />
              <Input
                aria-label={t('stock.unit')}
                placeholder={t('stock.unit')}
                value={l.unit}
                onChange={(e) => set(i, { unit: e.target.value })}
              />
              <Input
                aria-label={t('stock.kitchen.yield')}
                placeholder={t('stock.kitchen.yield')}
                inputMode="decimal"
                value={l.yieldPct}
                onChange={(e) => set(i, { yieldPct: e.target.value })}
              />
              <Input
                aria-label={t('stock.kitchen.wastage')}
                placeholder={t('stock.kitchen.wastage')}
                inputMode="decimal"
                value={l.wastagePct}
                onChange={(e) => set(i, { wastagePct: e.target.value })}
              />
            </div>
          </div>
        ))}
        <Button
          variant="secondary"
          size="sm"
          onClick={() =>
            setLines([...lines, { itemId: '', qty: '', unit: '', yieldPct: '100', wastagePct: '0' }])
          }
        >
          <Plus /> {t('stock.kitchen.addIngredient')}
        </Button>
        <p className="text-xs text-muted-foreground">{t('stock.kitchen.yieldHint')}</p>
      </div>
    </Dialog>
  );
}

function Orders() {
  const { t } = useTranslation();
  const q = useProduction();
  const [finish, setFinish] = useState<Production | null>(null);
  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} error={q.error} />;
  if (!q.data.length)
    return (
      <EmptyState icon={ChefHat} title={t('stock.kitchen.noOrders')} body={t('stock.kitchen.noOrdersBody')} />
    );
  return (
    <>
      <ul className="space-y-2">
        {q.data.map((o) => (
          <li key={o.id}>
            <Card className="flex flex-wrap items-center gap-x-4 gap-y-2 p-3">
              <div className="min-w-0 flex-1 basis-48">
                <div className="truncate font-medium">{o.item?.name}</div>
                <div className="text-xs text-muted-foreground">
                  <span className="font-mono">{o.number}</span> · {o.location} ·{' '}
                  {t('stock.kitchen.planned', { qty: `${qty(o.plannedQty)} ${o.item?.unit ?? ''}` })}
                  {o.actualQty !== null && ` · ${t('stock.kitchen.made', { qty: qty(o.actualQty) })}`}
                  {o.batch?.expiry && ` · ${t('stock.expires', { date: formatLocalDate(o.batch.expiry) })}`}
                </div>
              </div>
              {o.variance !== null && o.variance !== 0 && (
                <StatusChip tone={o.variance < 0 ? 'warn' : 'info'}>
                  {t('stock.kitchen.variance', { qty: qty(o.variance) })}
                </StatusChip>
              )}
              <StatusChip tone={o.status === 'DONE' ? 'ok' : o.status === 'PLANNED' ? 'info' : 'neutral'}>
                {t(`stock.kitchen.status.${o.status}`)}
              </StatusChip>
              {o.status === 'PLANNED' && (
                <Button size="sm" variant="primary" onClick={() => setFinish(o)}>
                  {t('stock.kitchen.finish')}
                </Button>
              )}
            </Card>
          </li>
        ))}
      </ul>
      {finish && <FinishDialog order={finish} onClose={() => setFinish(null)} />}
    </>
  );
}

function PlanDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const recipes = useRecipes();
  const stock = useStock();
  const places = stock.data?.places ?? [];
  const made = (recipes.data ?? []).filter((r) => r.made === 'MAKE');
  const [d, setD] = useState({ itemId: '', qty: '', locationId: places[0]?.id ?? '' });
  const save = useStockMutation(
    () => post('/api/ims/production', { itemId: d.itemId, qty: Number(d.qty), locationId: d.locationId }),
    t('stock.kitchen.planSaved'),
  );
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('stock.kitchen.plan')}
      footer={
        <Button
          variant="primary"
          disabled={!d.itemId || !(Number(d.qty) > 0) || save.isPending}
          onClick={() => save.mutate(undefined, { onSuccess: onClose })}
        >
          {t('common.save')}
        </Button>
      }
    >
      <div className="space-y-3">
        <Field label={t('stock.kitchen.makesItem')} hint={t('stock.kitchen.madeOnly')}>
          <ItemSelect
            label={t('stock.kitchen.makesItem')}
            value={d.itemId}
            items={made.map((r) => ({
              id: r.itemId,
              code: r.code,
              name: r.name,
              unit: r.unit,
              category: null,
              active: true,
            }))}
            onChange={(itemId) => setD({ ...d, itemId })}
          />
        </Field>
        <Field label={t('stock.qty')}>
          <Input inputMode="decimal" value={d.qty} onChange={(e) => setD({ ...d, qty: e.target.value })} />
        </Field>
        <Field label={t('stock.location')}>
          <PlaceSelect
            label={t('stock.location')}
            value={d.locationId}
            places={places}
            onChange={(locationId) => setD({ ...d, locationId })}
          />
        </Field>
      </div>
    </Dialog>
  );
}

function FinishDialog({ order, onClose }: { order: Production; onClose: () => void }) {
  const { t } = useTranslation();
  const [actual, setActual] = useState(String(order.plannedQty));
  const save = useStockMutation(
    () => post(`/api/ims/production/${order.id}/finish`, { actualQty: Number(actual) }),
    t('stock.kitchen.finished'),
  );
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('stock.kitchen.finishOf', { number: order.number })}
      description={t('stock.kitchen.finishHint')}
      footer={
        <Button
          variant="primary"
          disabled={!(Number(actual) > 0) || save.isPending}
          onClick={() => save.mutate(undefined, { onSuccess: onClose })}
        >
          {t('stock.kitchen.finish')}
        </Button>
      }
    >
      <Field label={t('stock.kitchen.actual', { unit: order.item?.unit ?? '' })}>
        <Input inputMode="decimal" value={actual} onChange={(e) => setActual(e.target.value)} autoFocus />
      </Field>
    </Dialog>
  );
}
