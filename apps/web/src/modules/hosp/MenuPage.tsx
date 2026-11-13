import { Plus, Upload, UtensilsCrossed } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { hasPermission, type Me } from '@mono/shared';
import { EmptyState, ErrorState, PageHeader, PageSkeleton } from '@/components/page';
import { StatusChip } from '@/components/status-chip';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Switch, Textarea } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { rupees } from '@/modules/stock/api';
import { send, useHospMutation, useMenu, type MenuItem } from './api';
import { MenuItemDialog } from './MenuItemDialog';

const DIET_TONE = { VEG: 'ok', NONVEG: 'bad', EGG: 'warn' } as const;

/** The menu (phase 14): categories and items with variants and prices; switch an item off (86) when it runs out. */
export function MenuPage({ me }: { me: Me }) {
  const { t } = useTranslation();
  const q = useMenu();
  const [cat, setCat] = useState('');
  const [search, setSearch] = useState('');
  const [edit, setEdit] = useState<Partial<MenuItem> | null>(null);
  const [newCat, setNewCat] = useState(false);
  const [paste, setPaste] = useState(false);
  const canEdit = hasPermission(me.user.permissions, 'hosp.edit');
  const off = useHospMutation((a: { id: string; off: boolean }) =>
    send('POST', `/api/hosp/menu/items/${a.id}/86`, { off: a.off }),
  );
  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  const items = q.data.items.filter(
    (i) => (!cat || i.categoryId === cat) && i.name.toLowerCase().includes(search.trim().toLowerCase()),
  );
  return (
    <div>
      <PageHeader
        title={t('hosp.menu.title')}
        subtitle={t('hosp.menu.subtitle')}
        actions={
          canEdit && (
            <>
              <Button variant="secondary" onClick={() => setPaste(true)}>
                <Upload /> {t('hosp.menu.paste')}
              </Button>
              <Button variant="secondary" onClick={() => setNewCat(true)}>
                <Plus /> {t('hosp.menu.category')}
              </Button>
              <Button
                variant="primary"
                disabled={!q.data.categories.length}
                onClick={() => setEdit({ categoryId: cat || q.data.categories[0]?.id })}
              >
                <Plus /> {t('hosp.menu.item')}
              </Button>
            </>
          )
        }
      />
      {q.data.categories.length === 0 ? (
        <EmptyState
          icon={UtensilsCrossed}
          title={t('hosp.menu.emptyTitle')}
          body={t('hosp.menu.emptyBody')}
        />
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="-mx-1 flex max-w-full gap-1 overflow-x-auto px-1" role="tablist">
              {[{ id: '', name: t('hosp.menu.all'), items: q.data.items.length }, ...q.data.categories].map(
                (c) => (
                  <button
                    key={c.id || 'all'}
                    role="tab"
                    aria-selected={cat === c.id}
                    onClick={() => setCat(c.id)}
                    className={cn(
                      'h-9 shrink-0 rounded-pill border px-3 text-sm font-medium',
                      cat === c.id
                        ? 'border-transparent bg-accent-soft text-accent-soft-foreground'
                        : 'bg-card text-muted-foreground',
                    )}
                  >
                    {c.name} · {c.items}
                  </button>
                ),
              )}
            </div>
            <Input
              aria-label={t('hosp.menu.search')}
              placeholder={t('hosp.menu.search')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="sm:ml-auto sm:w-64"
            />
          </div>
          <ul className="space-y-2">
            {items.map((i) => (
              <li key={i.id}>
                <Card className="flex flex-wrap items-center gap-x-4 gap-y-2 p-3">
                  <button
                    type="button"
                    disabled={!canEdit}
                    className="min-w-0 flex-1 basis-48 text-left"
                    onClick={() => setEdit(i)}
                  >
                    <div className="truncate font-medium">
                      {i.name}
                      {i.nameHi && (
                        <span className="ml-2 text-sm font-normal text-muted-foreground">{i.nameHi}</span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {i.variants.length
                        ? i.variants.map((v) => `${v.name} ${rupees(v.price)}`).join(' · ')
                        : rupees(i.price)}
                      {i.modifierGroupIds.length > 0 &&
                        ` · ${t('hosp.menu.addOns', { count: i.modifierGroupIds.length })}`}
                      {i.combo.length > 0 && ` · ${t('hosp.menu.combo')}`}
                    </div>
                  </button>
                  <StatusChip tone={DIET_TONE[i.diet]}>{t(`hosp.menu.diet.${i.diet}`)}</StatusChip>
                  <label className="flex items-center gap-2 text-sm">
                    <Switch
                      aria-label={t('hosp.menu.onSale', { name: i.name })}
                      checked={!i.off}
                      onCheckedChange={(v) => off.mutate({ id: i.id, off: !v })}
                    />
                    {i.off ? t('hosp.menu.is86') : t('hosp.menu.selling')}
                  </label>
                </Card>
              </li>
            ))}
          </ul>
        </>
      )}
      {edit && <MenuItemDialog item={edit} setup={q.data} onClose={() => setEdit(null)} />}
      {newCat && <CategoryDialog onClose={() => setNewCat(false)} />}
      {paste && <PasteDialog onClose={() => setPaste(false)} />}
    </div>
  );
}

function CategoryDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [d, setD] = useState({ name: '', nameHi: '' });
  const save = useHospMutation(
    () => send('POST', '/api/hosp/menu/categories', { name: d.name, nameHi: d.nameHi || null }),
    t('org.saved'),
  );
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('hosp.menu.category')}
      footer={
        <Button
          variant="primary"
          disabled={!d.name.trim() || save.isPending}
          onClick={() => save.mutate(undefined, { onSuccess: onClose })}
        >
          {t('common.save')}
        </Button>
      }
    >
      <div className="space-y-3">
        <Field label={t('org.name')}>
          <Input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} autoFocus />
        </Field>
        <Field label={t('hosp.menu.nameHi')}>
          <Input value={d.nameHi} onChange={(e) => setD({ ...d, nameHi: e.target.value })} />
        </Field>
      </div>
    </Dialog>
  );
}

/** Paste a menu: category, name, price, diet, variants — all or nothing, with problems named by line. */
function PasteDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [problems, setProblems] = useState<{ line: number; message: string }[]>([]);
  const save = useHospMutation(
    async () => {
      try {
        return await send<{ items: number }>('POST', '/api/hosp/menu/import', { text });
      } catch (e) {
        const list =
          e instanceof ApiError
            ? (e.details as { problems?: { line: number; message: string }[] } | undefined)?.problems
            : undefined;
        setProblems(list ?? []);
        throw e;
      }
    },
    (r) => t('hosp.menu.imported', { count: r.items }),
  );
  return (
    <Dialog
      open
      wide
      onOpenChange={(o) => !o && onClose()}
      title={t('hosp.menu.paste')}
      description={t('hosp.menu.pasteHint')}
      footer={
        <Button
          variant="primary"
          disabled={!text.trim() || save.isPending}
          onClick={() => save.mutate(undefined, { onSuccess: onClose })}
        >
          {t('hosp.menu.import')}
        </Button>
      }
    >
      <Textarea
        aria-label={t('hosp.menu.paste')}
        rows={10}
        className="font-mono text-sm"
        value={text}
        placeholder={'Starters, Paneer tikka, 320, veg, Half=180|Full=320'}
        onChange={(e) => setText(e.target.value)}
      />
      {problems.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm text-status-bad-fg">
          {problems.map((p) => (
            <li key={`${p.line}${p.message}`}>
              {t('hosp.menu.problem', { line: p.line, message: p.message })}
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
