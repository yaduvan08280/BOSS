import { useDraggable, useDroppable } from '@dnd-kit/core';
import { Crown, Plus, UserRound } from 'lucide-react';
import { useContext } from 'react';
import { useTranslation } from 'react-i18next';
import type { OrgDepartment, OrgPerson } from '@mono/shared';
import { personLabel } from '@/lib/people';
import { Avatar } from '@/components/brand';
import { Select } from '@/components/ui/form';
import { cn } from '@/lib/utils';
import { ZoomContext } from './zoom';

const DOT = { ACTIVE: 'bg-status-ok', INACTIVE: 'bg-status-neutral', LEFT: 'bg-status-bad' } as const;

export type DragData = { person: OrgPerson; fromDept: string | null };

export function PersonCard({
  person,
  fromDept,
  onOpen,
  compact,
}: {
  person: OrgPerson;
  fromDept: string | null;
  onOpen: (p: OrgPerson) => void;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const { setNodeRef, listeners, attributes, transform, isDragging } = useDraggable({
    id: `person:${person.id}:${fromDept ?? 'none'}`,
    data: { person, fromDept } satisfies DragData,
  });
  const zoom = useContext(ZoomContext);
  return (
    <button
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={() => onOpen(person)}
      style={
        transform ? { transform: `translate(${transform.x / zoom}px, ${transform.y / zoom}px)` } : undefined
      }
      className={cn(
        'flex w-full touch-none items-center gap-2.5 rounded-control border bg-card p-2 text-left transition-shadow hover:border-ring/40',
        isDragging && 'relative z-20 shadow-2xl ring-2 ring-ring/40',
        person.status !== 'ACTIVE' && 'opacity-60',
      )}
      aria-label={t('org.chart.personLabel', { name: person.name })}
    >
      <span className="relative">
        <Avatar name={person.name} url={person.avatarUrl} className={compact ? 'size-8' : 'size-9'} />
        <span
          className={cn(
            'absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-card',
            DOT[person.status],
          )}
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{person.name}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {person.designationName ?? person.roleName}
        </span>
        {person.branchName && (
          <span className="block truncate text-[11px] text-muted-foreground/80">{person.branchName}</span>
        )}
      </span>
    </button>
  );
}

type ColumnProps = {
  dept: OrgDepartment | null;
  parentName?: string;
  members: OrgPerson[];
  hod: OrgPerson | undefined;
  candidates: OrgPerson[];
  onOpen: (p: OrgPerson) => void;
  onAssignHod: (userId: string) => void;
  onAddPerson: () => void;
};

/** One department: head-of-department slot on top (drop to make HOD), then the team (drop to add/move). */
export function DeptColumn({
  dept,
  parentName,
  members,
  hod,
  candidates,
  onOpen,
  onAssignHod,
  onAddPerson,
}: ColumnProps) {
  const { t } = useTranslation();
  const key = dept?.id ?? 'none';
  const { setNodeRef: setColumnRef, isOver: overColumn } = useDroppable({ id: `dept:${key}` });
  const { setNodeRef: setHeadRef, isOver: overHead } = useDroppable({ id: `hod:${key}`, disabled: !dept });
  const team = members.filter((m) => m.id !== hod?.id);
  return (
    <section
      ref={setColumnRef}
      data-dept={dept?.name ?? 'none'}
      className={cn(
        'flex w-64 shrink-0 flex-col gap-2 rounded-card border bg-muted/40 p-2.5 transition-colors',
        overColumn && 'border-ring bg-accent-soft/40',
      )}
    >
      <header className="flex items-center gap-2 px-1 pt-0.5">
        <span
          className="grid size-6 place-items-center rounded-md text-[11px] font-bold text-white"
          style={{ background: dept?.color ?? '#6B6862' }}
        >
          {(dept?.name ?? '?')[0]?.toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{dept?.name ?? t('org.chart.noDept')}</div>
          {parentName && <div className="truncate text-[11px] text-muted-foreground">{parentName}</div>}
        </div>
        <span className="tabular text-xs text-muted-foreground">{members.length}</span>
      </header>

      {dept && (
        <div
          ref={setHeadRef}
          data-hod-slot={dept.name}
          className={cn(
            'rounded-control border-2 border-dashed p-1.5 transition-colors',
            overHead ? 'border-ring bg-accent-soft' : hod ? 'border-transparent' : 'border-border',
          )}
        >
          {hod ? (
            <div className="relative">
              <PersonCard person={hod} fromDept={dept.id} onOpen={onOpen} />
              <span className="pointer-events-none absolute right-2 top-2 inline-flex items-center gap-1 rounded-pill bg-accent px-1.5 py-0.5 text-[10px] font-bold text-accent-foreground">
                <Crown className="size-3" /> HOD
              </span>
            </div>
          ) : (
            <div className="space-y-1.5 p-1 text-center">
              <div className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
                <UserRound className="size-3.5" /> {t('org.chart.noHod')}
              </div>
              <Select
                value=""
                onChange={(e) => e.target.value && onAssignHod(e.target.value)}
                className="h-8 text-xs sm:h-8"
                aria-label={t('org.chart.assign')}
              >
                <option value="">{t('org.chart.assign')}</option>
                {candidates.map((p) => (
                  <option key={p.id} value={p.id}>
                    {personLabel(p)}
                  </option>
                ))}
              </Select>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        {team.map((p) => (
          <PersonCard key={p.id} person={p} fromDept={dept?.id ?? null} onOpen={onOpen} compact />
        ))}
      </div>
      {dept && (
        <button
          onClick={onAddPerson}
          className="mt-auto flex h-9 items-center justify-center gap-1.5 rounded-control border border-dashed text-xs text-muted-foreground hover:bg-card hover:text-foreground"
        >
          <Plus className="size-3.5" /> {t('org.chart.addPerson')}
        </button>
      )}
    </section>
  );
}
