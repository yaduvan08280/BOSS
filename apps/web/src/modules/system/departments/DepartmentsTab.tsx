import {
  DndContext,
  PointerSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { Blocks, Crown, GripVertical, Plus, Users, X } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { OrgDepartment, OrgPerson } from '@mono/shared';
import { Avatar } from '@/components/brand';
import { EmptyState, ErrorState, PageSkeleton } from '@/components/page';
import { Confirm } from '@/components/ui/dialog';
import { Select } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { del, patch, post, useDepartments, useOrgMutation, useUsers } from '../api';
import { childrenOf, membersOf } from './members';
import { SubDepartmentDialog } from './SubDepartmentDialog';

export function DepartmentsTab() {
  const { t } = useTranslation();
  const depts = useDepartments();
  const users = useUsers();
  const [name, setName] = useState('');
  const [openSub, setOpenSub] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<OrgDepartment | null>(null);
  const create = useOrgMutation((body: { name: string; parentId?: string }) =>
    post<OrgDepartment>('/api/org/departments', body),
  );
  const update = useOrgMutation(
    ({ id, ...body }: { id: string; parentId?: string | null; hodUserId?: string | null }) =>
      patch(`/api/org/departments/${id}`, body),
  );
  const remove = useOrgMutation((id: string) => del(`/api/org/departments/${id}`), {
    success: t('org.deleted'),
  });
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  );

  if (depts.isPending || users.isPending) return <PageSkeleton />;
  if (depts.isError || users.isError)
    return <ErrorState onRetry={() => void (depts.refetch(), users.refetch())} />;
  const all = depts.data;
  const people = users.data;
  const top = childrenOf(all, null);

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const moved = all.find((d) => d.id === active.id)!;
    const target = all.find((d) => d.id === over.id)!;
    const previous = moved.parentId;
    update.mutate(
      { id: moved.id, parentId: target.id },
      {
        onSuccess: () =>
          toast.success(t('org.departments.nestedToast', { name: moved.name, parent: target.name }), {
            action: {
              label: t('org.undo'),
              onClick: () => update.mutate({ id: moved.id, parentId: previous }),
            },
          }),
      },
    );
  };

  return (
    <div className="space-y-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const n = name.trim();
          if (n) create.mutate({ name: n }, { onSuccess: () => setName('') });
        }}
        className="flex max-w-xl gap-2"
      >
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('org.departments.typeEnter')}
          aria-label={t('org.departments.add')}
        />
      </form>
      <p className="-mt-2 text-xs text-muted-foreground">{t('org.departments.dragHint')}</p>
      {top.length === 0 ? (
        <EmptyState
          icon={Blocks}
          title={t('org.departments.emptyTitle')}
          body={t('org.departments.emptyBody')}
        />
      ) : (
        <DndContext sensors={sensors} onDragEnd={onDragEnd}>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {top.map((d) => (
              <DepartmentCard
                key={d.id}
                dept={d}
                all={all}
                people={people}
                onSetHod={(hodUserId) => update.mutate({ id: d.id, hodUserId })}
                onAddSub={(n) => create.mutate({ name: n, parentId: d.id })}
                onOpenSub={setOpenSub}
                onDelete={() => setConfirmDelete(d)}
              />
            ))}
          </div>
        </DndContext>
      )}
      {openSub && (
        <SubDepartmentDialog
          deptId={openSub}
          all={all}
          people={people}
          onClose={() => setOpenSub(null)}
          onOpen={setOpenSub}
        />
      )}
      <Confirm
        open={!!confirmDelete}
        onOpenChange={(o) => !o && setConfirmDelete(null)}
        title={t('org.departments.deleteTitle', { name: confirmDelete?.name })}
        body={t('org.departments.deleteBody')}
        confirm={t('org.delete')}
        danger
        onConfirm={() => confirmDelete && remove.mutate(confirmDelete.id)}
      />
    </div>
  );
}

type CardProps = {
  dept: OrgDepartment;
  all: OrgDepartment[];
  people: OrgPerson[];
  onSetHod: (id: string | null) => void;
  onAddSub: (name: string) => void;
  onOpenSub: (id: string) => void;
  onDelete: () => void;
};

function DepartmentCard({ dept, all, people, onSetHod, onAddSub, onOpenSub, onDelete }: CardProps) {
  const { t } = useTranslation();
  const {
    setNodeRef: setDragRef,
    listeners,
    attributes,
    transform,
    isDragging,
  } = useDraggable({ id: dept.id });
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: dept.id });
  const [subName, setSubName] = useState<string | null>(null);
  const members = membersOf(people, dept.id);
  const hod = people.find((p) => p.id === dept.hodUserId);
  const subs = childrenOf(all, dept.id);
  return (
    <div
      ref={setDropRef}
      className={cn('rounded-card transition-shadow', isOver && !isDragging && 'ring-3 ring-ring/40')}
    >
      <div
        ref={setDragRef}
        style={transform ? { transform: `translate(${transform.x}px, ${transform.y}px)` } : undefined}
        className={cn(
          'flex h-full flex-col gap-3 rounded-card border bg-card p-4',
          isDragging && 'relative z-10 opacity-90 shadow-2xl',
        )}
      >
        <div className="flex items-start gap-3">
          <button
            {...listeners}
            {...attributes}
            className="-ml-1 mt-2 cursor-grab touch-none text-muted-foreground active:cursor-grabbing"
            aria-label={t('org.departments.drag')}
          >
            <GripVertical className="size-4" />
          </button>
          <span
            className="grid size-11 shrink-0 place-items-center rounded-control text-lg font-bold text-white"
            style={{ background: dept.color ?? '#6B6862' }}
          >
            {dept.name[0]?.toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-semibold">{dept.name}</div>
            <div className="text-xs text-muted-foreground">
              {t('org.peopleCount', { count: dept.peopleCount })} ·{' '}
              {t('org.withLogin', { count: dept.withLogin })}
            </div>
          </div>
          <button
            onClick={onDelete}
            className="grid size-8 place-items-center rounded-control text-muted-foreground hover:bg-muted"
            aria-label={t('org.delete')}
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="flex items-center gap-2 rounded-control bg-muted/60 px-3 py-2">
          <Crown className="size-4 shrink-0 text-muted-foreground" />
          <Select
            aria-label={t('org.departments.hod')}
            value={dept.hodUserId ?? ''}
            onChange={(e) => onSetHod(e.target.value || null)}
            className="h-8 border-0 bg-transparent px-0 shadow-none sm:h-8"
          >
            <option value="">{t('org.departments.noHod')}</option>
            {(hod && !members.includes(hod) ? [hod, ...members] : members).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {subs.map((s) => (
            <button
              key={s.id}
              onClick={() => onOpenSub(s.id)}
              className="h-7 rounded-pill bg-accent-soft px-3 text-xs font-medium text-accent-soft-foreground"
            >
              {s.name} · {s.peopleCount}
            </button>
          ))}
          {subName === null ? (
            <button
              onClick={() => setSubName('')}
              className="inline-flex h-7 items-center gap-1 rounded-pill border border-dashed px-3 text-xs text-muted-foreground hover:text-foreground"
            >
              <Plus className="size-3.5" /> {t('org.departments.addSub')}
            </button>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (subName.trim()) onAddSub(subName.trim());
                setSubName(null);
              }}
            >
              <Input
                autoFocus
                value={subName}
                onChange={(e) => setSubName(e.target.value)}
                onBlur={() => setSubName(null)}
                className="h-8 w-44 sm:h-8"
                placeholder={t('org.departments.subPh')}
              />
            </form>
          )}
        </div>

        <div className="mt-auto flex items-center justify-between gap-2 border-t pt-3">
          <div className="flex -space-x-2">
            {members.slice(0, 6).map((p) => (
              <Avatar key={p.id} name={p.name} url={p.avatarUrl} className="size-8 ring-2 ring-card" />
            ))}
            {members.length > 6 && (
              <span className="tabular grid size-8 place-items-center rounded-full bg-muted text-[11px] font-semibold ring-2 ring-card">
                +{members.length - 6}
              </span>
            )}
          </div>
          <Link
            to={`/system/users?dept=${dept.id}`}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            <Users className="size-3.5" /> {t('org.departments.people')}
          </Link>
        </div>
      </div>
    </div>
  );
}
