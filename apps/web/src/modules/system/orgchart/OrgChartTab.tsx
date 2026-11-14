import {
  DndContext,
  pointerWithin,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
} from '@dnd-kit/core';
import { Maximize2, Minus, Plus, Search } from 'lucide-react';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { OrgPerson } from '@mono/shared';
import { ErrorState, PageSkeleton } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Select, Switch } from '@/components/ui/form';
import { cn } from '@/lib/utils';
import { post, useDepartments, useDesignations, useOrgMutation, useRoles, useUsers } from '../api';
import { membersOf } from '../departments/members';
import { AddPeopleDialog } from '../users/AddPeopleDialog';
import { TempPasswords, type TempPassword } from '../users/TempPasswords';
import { DeptColumn, PersonCard, type DragData } from './OrgColumns';
import { ZoomContext } from './zoom';
import { MoveDialog, PersonPanel, type PendingMove } from './OrgDialogs';
import { BranchBoard } from './BranchBoard';
import { OrgList } from './OrgList';
import { BranchMoveDialog } from '../users/BranchMoveDialog';
import { useStructure } from '../branches/api';
import { useMe } from '@/modules/auth/session';
import { hasPermission } from '@mono/shared';

type View = 'full' | 'chart' | 'list';

/** Drop exactly where the pointer is (nothing under it = no drop); a head slot wins over its column. */
const underPointer: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  const hod = hits.find((h) => String(h.id).startsWith('hod:'));
  return hod ? [hod] : hits;
};

export function OrgChartTab() {
  const { t } = useTranslation();
  const users = useUsers();
  const depts = useDepartments();
  const roles = useRoles();
  const designations = useDesignations();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<string>('all');
  const [showLeft, setShowLeft] = useState(false);
  const [view, setView] = useState<View>('full');
  const [by, setBy] = useState<'dept' | 'branch'>('dept');
  const [branch, setBranch] = useState('all');
  const [placing, setPlacing] = useState<{ people: OrgPerson[]; to?: string } | null>(null);
  const branches = useStructure().data?.branches ?? [];
  const me = useMe().data;
  const canMove = !!me && hasPermission(me.user.permissions, 'org.edit');
  const [zoom, setZoom] = useState(1);
  const [pending, setPending] = useState<PendingMove | null>(null);
  const [open, setOpen] = useState<OrgPerson | null>(null);
  const [addTo, setAddTo] = useState<string | null>(null);
  const [passwords, setPasswords] = useState<TempPassword[]>([]);
  const lastDrag = useRef(0);
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const move = useOrgMutation(
    (body: {
      userId: string;
      toDepartmentId: string;
      mode: 'also' | 'move' | 'hod';
      fromDepartmentId?: string | null;
    }) => post('/api/org/chart/move', body),
  );
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  );

  const all = useMemo(() => depts.data ?? [], [depts.data]);
  const deptMap = useMemo(() => new Map(all.map((d) => [d.id, d])), [all]);
  const people = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (users.data ?? []).filter(
      (p) =>
        (showLeft || p.status === 'ACTIVE') &&
        (by === 'branch' || branch === 'all' || p.branchId === branch || p.alsoBranchIds?.includes(branch)) &&
        (!needle || `${p.name} ${p.designationName ?? ''} ${p.code}`.toLowerCase().includes(needle)),
    );
  }, [users.data, q, showLeft, by, branch]);

  // A search result links here with ?person=<id>; show that person until the panel is closed.
  const [params, setParams] = useSearchParams();
  const linked = users.data?.find((p) => p.id === params.get('person')) ?? null;
  const shown = open ?? linked;
  const closePanel = () => {
    setOpen(null);
    if (params.has('person')) setParams({}, { replace: true });
  };

  useLayoutEffect(() => {
    if (content.current) setSize({ w: content.current.scrollWidth, h: content.current.scrollHeight });
  }, [people, all, filter, view]);

  if (users.isPending || depts.isPending) return <PageSkeleton />;
  if (users.isError || depts.isError) return <ErrorState onRetry={() => void users.refetch()} />;

  const everyone = users.data.filter((p) => p.status === 'ACTIVE');
  const owners = people.filter((p) => p.roleKey === 'OWNER');
  const columns = all.filter((d) => filter === 'all' || d.id === filter);
  const unassigned = people.filter(
    (p) => !p.mainDepartmentId && !p.alsoWorksIn.length && p.roleKey !== 'OWNER',
  );
  const stats = [
    [t('org.chart.stat.people'), everyone.length],
    [t('org.chart.stat.departments'), all.length],
    [t('org.chart.stat.hods'), `${all.filter((d) => d.hodUserId).length}/${all.length}`],
    [t('org.chart.stat.noDept'), everyone.filter((p) => !p.mainDepartmentId && !p.alsoWorksIn.length).length],
    [t('org.chart.stat.login'), `${everyone.filter((p) => p.loginEnabled).length}/${everyone.length}`],
  ] as const;

  const openPerson = (p: OrgPerson) => Date.now() - lastDrag.current > 300 && setOpen(p);
  const fit = () => {
    const w = viewport.current?.clientWidth ?? 0;
    if (w && size.w) setZoom(Math.max(0.4, Math.min(1, Math.floor((w / (size.w / zoom)) * 100) / 100)));
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    lastDrag.current = Date.now();
    if (!over) return;
    const { person, fromDept } = active.data.current as DragData;
    const [kind, target] = String(over.id).split(':') as ['dept' | 'hod', string];
    if (target === 'none') return;
    const to = deptMap.get(target)!;
    if (kind === 'hod') {
      if (to.hodUserId === person.id) return;
      move.mutate(
        { userId: person.id, toDepartmentId: to.id, mode: 'hod' },
        { onSuccess: () => toast.success(t('org.chart.madeHod', { name: person.name, dept: to.name })) },
      );
      return;
    }
    if (target === fromDept || person.mainDepartmentId === target || person.alsoWorksIn.includes(target))
      return;
    setPending({ person, from: fromDept ? (deptMap.get(fromDept) ?? null) : null, to });
  };

  const choose = (mode: 'also' | 'move') => {
    if (!pending) return;
    move.mutate(
      {
        userId: pending.person.id,
        toDepartmentId: pending.to.id,
        mode,
        fromDepartmentId: pending.from?.id ?? null,
      },
      {
        onSuccess: () =>
          toast.success(
            mode === 'move'
              ? t('org.chart.moved', { name: pending.person.name, to: pending.to.name })
              : t('org.chart.added', { name: pending.person.name, to: pending.to.name }),
          ),
      },
    );
    setPending(null);
  };

  const chart = (
    <div
      ref={viewport}
      className="overflow-auto rounded-card border bg-card/60 p-3"
      style={{ maxHeight: 'calc(100dvh - 220px)' }}
    >
      <div style={{ width: size.w * zoom || undefined, height: size.h * zoom || undefined }}>
        <div
          ref={content}
          className="w-max origin-top-left space-y-4"
          style={{ transform: `scale(${zoom})` }}
        >
          {owners.length > 0 && (
            <div className="flex justify-center gap-3">
              {owners.map((o) => (
                <div key={o.id} className="w-64 rounded-card border-2 border-ink bg-card p-1">
                  <PersonCard person={o} fromDept={o.mainDepartmentId} onOpen={openPerson} />
                </div>
              ))}
            </div>
          )}
          <div className="flex items-start gap-3">
            {columns.map((d) => {
              const members = membersOf(people, d.id);
              return (
                <DeptColumn
                  key={d.id}
                  dept={d}
                  parentName={d.parentId ? deptMap.get(d.parentId)?.name : undefined}
                  members={members}
                  hod={people.find((p) => p.id === d.hodUserId)}
                  candidates={members.length ? members : everyone}
                  onOpen={openPerson}
                  onAssignHod={(userId) => move.mutate({ userId, toDepartmentId: d.id, mode: 'hod' })}
                  onAddPerson={() => setAddTo(d.id)}
                />
              );
            })}
            {filter === 'all' && unassigned.length > 0 && (
              <DeptColumn
                dept={null}
                members={unassigned}
                hod={undefined}
                candidates={[]}
                onOpen={openPerson}
                onAssignHod={() => undefined}
                onAddPerson={() => undefined}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      {view === 'full' && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {stats.map(([label, value]) => (
            <Card key={label} className="p-3">
              <div className="text-xs text-muted-foreground">{label}</div>
              <div className="tabular text-xl font-semibold">{value}</div>
            </Card>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-control border bg-card px-3 max-sm:w-full max-sm:flex-none sm:max-w-xs">
          <Search className="size-4 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('org.chart.search')}
            className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
        </label>
        {view !== 'list' && by === 'dept' && (
          <div className="flex items-center rounded-control border bg-card">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setZoom((z) => Math.max(0.4, +(z - 0.1).toFixed(2)))}
              aria-label={t('org.chart.zoomOut')}
            >
              <Minus />
            </Button>
            <span className="tabular w-12 text-center text-xs">{Math.round(zoom * 100)}%</span>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setZoom((z) => Math.min(1.5, +(z + 0.1).toFixed(2)))}
              aria-label={t('org.chart.zoomIn')}
            >
              <Plus />
            </Button>
            <Button variant="ghost" size="sm" onClick={fit}>
              <Maximize2 /> {t('org.chart.fit')}
            </Button>
          </div>
        )}
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Switch checked={showLeft} onCheckedChange={setShowLeft} /> {t('org.chart.leftInactive')}
        </label>
        <Select
          value={branch}
          onChange={(e) => setBranch(e.target.value)}
          aria-label={t('org.place.branch')}
          className="h-10 w-auto max-w-[14rem]"
        >
          <option value="all">{t('org.place.allBranches')}</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </Select>
        <div className="flex rounded-control bg-muted p-1" role="group" aria-label={t('org.place.groupBy')}>
          {(['dept', 'branch'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setBy(v)}
              aria-pressed={by === v}
              className={cn(
                'h-8 rounded-[calc(var(--radius)*0.5)] px-3 text-xs font-medium',
                by === v ? 'bg-card shadow-sm' : 'text-muted-foreground',
              )}
            >
              {t(v === 'dept' ? 'org.place.byDept' : 'org.place.byBranch')}
            </button>
          ))}
        </div>
        <div className={cn('ml-auto flex rounded-control bg-muted p-1', by === 'branch' && 'hidden')}>
          {(['full', 'chart', 'list'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={cn(
                'h-8 rounded-[calc(var(--radius)*0.5)] px-3 text-xs font-medium',
                view === v ? 'bg-card shadow-sm' : 'text-muted-foreground',
              )}
            >
              {t(`org.chart.view.${v}`)}
            </button>
          ))}
        </div>
      </div>
      <div
        className={cn(
          '-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0',
          by === 'branch' && 'hidden',
        )}
      >
        {[{ id: 'all', name: t('home.all') }, ...all].map((d) => (
          <button
            key={d.id}
            onClick={() => setFilter(d.id)}
            className={cn(
              'h-8 shrink-0 rounded-pill border px-3 text-xs font-medium',
              filter === d.id ? 'border-ink bg-ink text-ink-foreground' : 'bg-card text-muted-foreground',
            )}
          >
            {d.name}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {t(by === 'branch' ? 'org.place.boardHint' : 'org.chart.hint')}
      </p>
      {by === 'branch' ? (
        <BranchBoard
          people={people}
          everyone={users.data}
          depts={deptMap}
          branchFilter={branch}
          canMove={canMove}
          onOpen={setOpen}
          onMove={(list, to) => setPlacing({ people: list, to })}
        />
      ) : view === 'list' ? (
        <OrgList columns={columns} people={people} onOpen={setOpen} />
      ) : (
        <ZoomContext.Provider value={zoom}>
          <DndContext sensors={sensors} collisionDetection={underPointer} onDragEnd={onDragEnd}>
            {chart}
          </DndContext>
        </ZoomContext.Provider>
      )}
      <MoveDialog move={pending} onChoose={choose} onCancel={() => setPending(null)} />
      <PersonPanel
        person={shown}
        depts={deptMap}
        onClose={closePanel}
        onPlace={canMove ? (p) => (closePanel(), setPlacing({ people: [p] })) : undefined}
      />
      {placing && (
        <BranchMoveDialog
          key={placing.people.map((p) => p.id).join()}
          people={placing.people}
          toBranchId={placing.to}
          onClose={() => setPlacing(null)}
        />
      )}
      <AddPeopleDialog
        key={addTo ?? 'none'}
        open={!!addTo}
        onClose={() => setAddTo(null)}
        departments={all}
        designations={designations.data ?? []}
        roles={roles.data?.roles ?? []}
        people={users.data}
        defaultDept={addTo ?? undefined}
        onPasswords={setPasswords}
      />
      <TempPasswords items={passwords} onClose={() => setPasswords([])} />
    </div>
  );
}
