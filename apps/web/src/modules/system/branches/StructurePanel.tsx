import { Archive, Building2, Copy, Landmark, MapPinned, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { EmptyState, ErrorState, PageSkeleton } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/form';
import { del, useOrgMutation, useUsers } from '../api';
import { regionTree, useStructure, type Entity, type GroupBranch, type Region } from './api';
import { CloseBranchDialog, CopyBranchDialog } from './BranchLifecycle';
import { BranchDialog, EntityDialog, RegionDialog } from './StructureDialogs';

type Open =
  | { what: 'entity'; row: Partial<Entity> }
  | { what: 'region'; row: Partial<Region> }
  | { what: 'branch'; row: Partial<GroupBranch> }
  | { what: 'copy' | 'close'; row: GroupBranch }
  | null;

function Section({
  title,
  hint,
  add,
  onAdd,
  children,
}: {
  title: string;
  hint: string;
  add: string;
  onAdd: () => void;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{title}</h2>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </div>
        <Button variant="secondary" size="sm" onClick={onAdd}>
          <Plus /> {add}
        </Button>
      </div>
      {children}
    </section>
  );
}

/** The group's structure: legal entities, regions (any depth) and branches with the people who run them. */
export function StructurePanel() {
  const { t } = useTranslation();
  const q = useStructure();
  const users = useUsers();
  const [open, setOpen] = useState<Open>(null);
  const remove = useOrgMutation((url: string) => del(url), { success: t('org.deleted') });

  if (q.isPending || users.isPending) return <PageSkeleton />;
  if (q.isError || users.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  const s = q.data;
  const people = users.data;
  const name = new Map(people.map((p) => [p.id, p.name]));
  const names = (ids: string[]) => ids.map((id) => name.get(id) ?? '?').join(', ');
  const entityName = new Map(s.entities.map((e) => [e.id, e.name]));
  const regionName = new Map(s.regions.map((r) => [r.id, r.name]));
  const held = (role: string, at: { branchId?: string; regionId?: string }) =>
    s.managers
      .filter(
        (m) => m.role === role && (at.branchId ? m.branchId === at.branchId : m.regionId === at.regionId),
      )
      .map((m) => m.userId);
  const actions = (edit: () => void, url: string) => (
    <div className="flex shrink-0">
      <Button variant="ghost" size="icon-sm" aria-label={t('org.edit')} onClick={edit}>
        <Pencil />
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label={t('org.delete')} onClick={() => remove.mutate(url)}>
        <Trash2 />
      </Button>
    </div>
  );
  const close = () => setOpen(null);
  const shared = { structure: s, people, onClose: close };

  return (
    <div className="max-w-3xl space-y-7">
      <Section
        title={t('branches.entity.many')}
        hint={t('branches.entity.hint')}
        add={t('branches.entity.add')}
        onAdd={() => setOpen({ what: 'entity', row: {} })}
      >
        {s.entities.length === 0 ? (
          <EmptyState
            icon={Landmark}
            title={t('branches.entity.emptyTitle')}
            body={t('branches.entity.emptyBody')}
          />
        ) : (
          <ul className="space-y-2">
            {s.entities.map((e) => (
              <li key={e.id}>
                <Card className="flex items-center gap-3 p-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 font-medium">
                      {e.name}
                      <Badge>{t(`branches.entity.${e.kind}`)}</Badge>
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {[e.country, e.currency, e.state, e.taxId].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  {actions(() => setOpen({ what: 'entity', row: e }), `/api/branches/entities/${e.id}`)}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        title={t('branches.region.many')}
        hint={t('branches.region.hint')}
        add={t('branches.region.add')}
        onAdd={() => setOpen({ what: 'region', row: {} })}
      >
        {s.regions.length === 0 ? (
          <EmptyState
            icon={MapPinned}
            title={t('branches.region.emptyTitle')}
            body={t('branches.region.emptyBody')}
          />
        ) : (
          <ul className="space-y-2">
            {regionTree(s.regions).map(({ region: r, depth }) => {
              const area = held('AREA', { regionId: r.id });
              return (
                <li key={r.id} style={{ paddingLeft: `${Math.min(depth, 4) * 16}px` }}>
                  <Card className="flex items-center gap-3 p-3">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{r.name}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {area.length
                          ? t('branches.areaManagersAre', { names: names(area) })
                          : t('branches.noAreaManager')}
                      </div>
                    </div>
                    {actions(() => setOpen({ what: 'region', row: r }), `/api/branches/regions/${r.id}`)}
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section
        title={t('branches.branch.many')}
        hint={t('branches.branch.hint')}
        add={t('org.branches.add')}
        onAdd={() => setOpen({ what: 'branch', row: {} })}
      >
        {s.branches.length === 0 ? (
          <EmptyState
            icon={Building2}
            title={t('org.branches.emptyTitle')}
            body={t('org.branches.emptyBody')}
          />
        ) : (
          <ul className="space-y-2">
            {s.branches.map((b) => {
              const managers = held('MANAGER', { branchId: b.id });
              const place = [
                b.regionId && regionName.get(b.regionId),
                b.entityId && entityName.get(b.entityId),
                b.city,
              ].filter(Boolean);
              return (
                <li key={b.id}>
                  <Card className="flex items-center gap-3 p-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 font-medium">
                        {b.name}
                        {b.code && <span className="font-mono text-xs text-muted-foreground">{b.code}</span>}
                        <Badge>{t(`branches.type.${b.type}`)}</Badge>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {[...place, t('org.peopleCount', { count: b.people })].join(' · ')}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {managers.length
                          ? t('branches.managersAre', { names: names(managers) })
                          : t('branches.noManager')}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-wrap justify-end">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t('branches.copy.button')}
                        title={t('branches.copy.button')}
                        onClick={() => setOpen({ what: 'copy', row: b })}
                      >
                        <Copy />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t('org.edit')}
                        onClick={() => setOpen({ what: 'branch', row: b })}
                      >
                        <Pencil />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t('branches.close.button')}
                        title={t('branches.close.button')}
                        onClick={() => setOpen({ what: 'close', row: b })}
                      >
                        <Archive />
                      </Button>
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      {open?.what === 'entity' && <EntityDialog entity={open.row} onClose={close} />}
      {open?.what === 'region' && <RegionDialog region={open.row} {...shared} />}
      {open?.what === 'branch' && <BranchDialog branch={open.row} {...shared} />}
      {open?.what === 'copy' && <CopyBranchDialog branch={open.row} onClose={close} />}
      {open?.what === 'close' && (
        <CloseBranchDialog
          branch={open.row}
          others={s.branches.filter((b) => b.id !== open.row.id)}
          onClose={close}
        />
      )}
    </div>
  );
}
