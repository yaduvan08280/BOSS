import {
  DndContext,
  PointerSensor,
  TouchSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { AlertTriangle, Building2, Crown } from 'lucide-react';
import { useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { OrgDepartment, OrgPerson } from '@mono/shared';
import { Avatar } from '@/components/brand';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useStructure, type GroupBranch } from '../branches/api';

const DOT = { ACTIVE: 'bg-status-ok', INACTIVE: 'bg-status-neutral', LEFT: 'bg-status-bad' } as const;

function Person({
  person,
  from,
  also,
  onOpen,
}: {
  person: OrgPerson;
  from: string;
  also?: boolean;
  onOpen: (p: OrgPerson) => void;
}) {
  const { setNodeRef, listeners, attributes, transform, isDragging } = useDraggable({
    id: `bp:${person.id}:${from}`,
    data: { person },
    disabled: also,
  });
  return (
    <button
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={() => onOpen(person)}
      style={transform ? { transform: `translate(${transform.x}px, ${transform.y}px)` } : undefined}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-control border bg-card p-2 text-left hover:border-ring/40',
        !also && 'touch-none',
        also && 'border-dashed bg-transparent',
        isDragging && 'relative z-20 shadow-2xl ring-2 ring-ring/40',
        person.status !== 'ACTIVE' && 'opacity-60',
      )}
    >
      <span className="relative shrink-0">
        <Avatar name={person.name} url={person.avatarUrl} className="size-8" />
        <span
          className={cn(
            'absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2 ring-card',
            DOT[person.status],
          )}
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{person.name}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {person.designationName ?? person.roleName}
        </span>
      </span>
    </button>
  );
}

function Column({
  branch,
  people,
  also,
  managers,
  depts,
  onOpen,
  onGive,
}: {
  branch: GroupBranch | null;
  people: OrgPerson[];
  also: OrgPerson[];
  managers: OrgPerson[];
  depts: Map<string, OrgDepartment>;
  onOpen: (p: OrgPerson) => void;
  onGive?: () => void;
}) {
  const { t } = useTranslation();
  const key = branch?.id ?? 'none';
  const { setNodeRef, isOver } = useDroppable({ id: `branch:${key}`, disabled: !branch });
  // The team by department, the largest department first.
  const groups = useMemo(() => {
    const by = new Map<string, OrgPerson[]>();
    for (const p of people) {
      const name = (p.mainDepartmentId && depts.get(p.mainDepartmentId)?.name) || t('org.place.noDept');
      by.set(name, [...(by.get(name) ?? []), p]);
    }
    return [...by].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  }, [people, depts, t]);
  return (
    <section
      ref={setNodeRef}
      data-branch={branch?.name ?? 'none'}
      className={cn(
        'flex w-full shrink-0 flex-col gap-2 rounded-card border bg-muted/40 p-2.5 transition-colors md:w-72',
        isOver && 'border-ring bg-accent-soft/40',
        !branch && 'border-status-warn bg-status-warn-bg/40',
      )}
    >
      <header className="flex items-start gap-2 px-1 pt-0.5">
        <span className="grid size-7 shrink-0 place-items-center rounded-md bg-ink text-ink-foreground">
          {branch ? <Building2 className="size-4" /> : <AlertTriangle className="size-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm leading-tight font-semibold">{branch?.name ?? t('org.place.noBranch')}</div>
          <div className="text-[11px] text-muted-foreground">
            {branch
              ? [t(`branches.type.${branch.type}`), branch.city].filter(Boolean).join(' · ')
              : t('org.place.noBranchWarn', { count: people.length })}
          </div>
        </div>
        <span className="tabular rounded-pill bg-card px-2 py-0.5 text-xs font-semibold">
          {people.length}
        </span>
      </header>
      {branch && (
        <div className="rounded-control border border-dashed p-1.5">
          <div className="mb-1 flex items-center gap-1 px-1 text-[11px] font-semibold text-muted-foreground">
            <Crown className="size-3" /> {t('org.place.managers')}
          </div>
          {managers.length ? (
            <div className="flex flex-col gap-1.5">
              {managers.map((m) => (
                <Person key={m.id} person={m} from={`${key}:m`} also onOpen={onOpen} />
              ))}
            </div>
          ) : (
            <p className="px-1 pb-1 text-xs text-muted-foreground">{t('org.place.noManager')}</p>
          )}
        </div>
      )}
      {!branch && onGive && (
        <Button size="sm" variant="primary" onClick={onGive}>
          {t('org.place.giveBranch')}
        </Button>
      )}
      {groups.map(([name, list]) => (
        <div key={name} className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between px-1 pt-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
            <span className="truncate">{name}</span>
            <span className="tabular">{list.length}</span>
          </div>
          {list.map((p) => (
            <Person key={p.id} person={p} from={key} onOpen={onOpen} />
          ))}
        </div>
      ))}
      {also.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <div className="px-1 pt-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
            {t('org.place.alsoHere')}
          </div>
          {also.map((p) => (
            <Person key={p.id} person={p} from={`${key}:also`} also onOpen={onOpen} />
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * The organisation by place: one column per branch with its managers and its people (by department), and a
 * column for people who have no branch yet. Dropping a person on another branch starts a transfer.
 */
export function BranchBoard({
  people,
  everyone,
  depts,
  branchFilter,
  canMove,
  onOpen,
  onMove,
}: {
  people: OrgPerson[];
  everyone: OrgPerson[];
  depts: Map<string, OrgDepartment>;
  branchFilter: string;
  canMove: boolean;
  onOpen: (p: OrgPerson) => void;
  onMove: (people: OrgPerson[], toBranchId?: string) => void;
}) {
  const structure = useStructure().data;
  const lastDrag = useRef(0);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  );
  const branches = (structure?.branches ?? []).filter((b) => branchFilter === 'all' || b.id === branchFilter);
  const byId = new Map(everyone.map((p) => [p.id, p]));
  const none = people.filter((p) => !p.branchId && p.roleKey !== 'OWNER');
  const open = (p: OrgPerson) => Date.now() - lastDrag.current > 300 && onOpen(p);
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    lastDrag.current = Date.now();
    if (!over || !canMove) return;
    const person = (active.data.current as { person: OrgPerson }).person;
    const to = String(over.id).slice('branch:'.length);
    if (to !== 'none' && to !== person.branchId) onMove([person], to);
  };
  return (
    <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragEnd={onDragEnd}>
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:overflow-x-auto md:pb-2">
        {branchFilter === 'all' && none.length > 0 && (
          <Column
            branch={null}
            people={none}
            also={[]}
            managers={[]}
            depts={depts}
            onOpen={open}
            onGive={canMove ? () => onMove(none) : undefined}
          />
        )}
        {branches.map((b) => (
          <Column
            key={b.id}
            branch={b}
            people={people.filter((p) => p.branchId === b.id)}
            also={people.filter((p) => p.alsoBranchIds?.includes(b.id))}
            managers={(structure?.managers ?? [])
              .filter((m) => m.branchId === b.id && m.role === 'MANAGER')
              .flatMap((m) => byId.get(m.userId) ?? [])}
            depts={depts}
            onOpen={open}
          />
        ))}
      </div>
    </DndContext>
  );
}
