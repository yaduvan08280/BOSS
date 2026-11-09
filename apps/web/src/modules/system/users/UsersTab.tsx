import { LayoutGrid, Plus, Rows3, Search, Send, UserPlus, Users, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { hasPermission, type BulkAction, type OrgPerson } from '@mono/shared';
import { EmptyState, ErrorState, PageSkeleton } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Confirm, useIsPhone } from '@/components/ui/dialog';
import { Select } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { cn, safeStorage } from '@/lib/utils';
import { useMe } from '@/modules/auth/session';
import { del, post, useDepartments, useDesignations, useOrgMutation, useRoles, useUsers } from '../api';
import { AddPeopleDialog } from './AddPeopleDialog';
import { PersonSheet } from './PersonSheet';
import { TempPasswords, type TempPassword } from './TempPasswords';
import { UserCards, UsersTable, type RowActions } from './UserRows';

const VIEW_KEY = 'mono.usersView';

export function UsersTab() {
  const { t } = useTranslation();
  const me = useMe().data!;
  const phone = useIsPhone();
  const [params, setParams] = useSearchParams();
  const users = useUsers();
  const depts = useDepartments();
  const designations = useDesignations();
  const roles = useRoles();
  const [q, setQ] = useState('');
  const [view, setView] = useState<'grid' | 'cards'>(() =>
    safeStorage.get(VIEW_KEY) === 'cards' ? 'cards' : 'grid',
  );
  const [group, setGroup] = useState<'team' | 'hr'>('team');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<OrgPerson | null>(null);
  const [deleting, setDeleting] = useState<OrgPerson | null>(null);
  const [resetting, setResetting] = useState<OrgPerson | null>(null);
  const [passwords, setPasswords] = useState<TempPassword[]>([]);
  const [newDept, setNewDept] = useState<string | null>(null);
  const canAdmin = hasPermission(me.user.permissions, 'org.admin');
  const canHr = hasPermission(me.user.permissions, 'hr.admin');
  const dept = params.get('dept') ?? 'all';

  const login = useOrgMutation(({ p, on }: { p: OrgPerson; on: boolean }) =>
    post<{ tempPassword: string | null }>(`/api/org/users/${p.id}/login`, { enabled: on }),
  );
  const reset = useOrgMutation((p: OrgPerson) =>
    post<{ tempPassword: string }>(`/api/org/users/${p.id}/reset-password`),
  );
  const remove = useOrgMutation((p: OrgPerson) => del(`/api/org/users/${p.id}`), {
    success: t('org.deleted'),
  });
  const bulk = useOrgMutation((body: BulkAction) =>
    post<{ updated: number; passwords: (TempPassword & { id: string })[]; skipped: number }>(
      '/api/org/users/bulk-action',
      body,
    ),
  );
  const createDept = useOrgMutation((name: string) => post('/api/org/departments', { name }));

  const deptMap = useMemo(() => new Map((depts.data ?? []).map((d) => [d.id, d])), [depts.data]);
  const all = useMemo(() => users.data ?? [], [users.data]);
  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all.filter((p) => {
      if (
        dept === 'none'
          ? p.mainDepartmentId || p.alsoWorksIn.length
          : dept !== 'all' && p.mainDepartmentId !== dept && !p.alsoWorksIn.includes(dept)
      )
        return false;
      if (!needle) return true;
      const deptName = p.mainDepartmentId ? (deptMap.get(p.mainDepartmentId)?.name ?? '') : '';
      return [p.name, p.code, p.mobile ?? '', p.email ?? '', deptName]
        .join(' ')
        .toLowerCase()
        .includes(needle);
    });
  }, [all, q, dept, deptMap]);

  if (users.isPending || depts.isPending) return <PageSkeleton />;
  if (users.isError || depts.isError) return <ErrorState onRetry={() => void users.refetch()} />;

  const setDept = (id: string) => setParams(id === 'all' ? {} : { dept: id }, { replace: true });
  const toggle = (id: string) =>
    setSelected((s) => (s.has(id) ? (s.delete(id), new Set(s)) : new Set(s.add(id))));
  const allTicked = visible.length > 0 && visible.every((p) => selected.has(p.id));
  const actions: RowActions = {
    selected,
    toggle,
    canAdmin,
    meId: me.user.id,
    open: setEditing,
    remove: setDeleting,
    setLogin: (p, on) =>
      login.mutate(
        { p, on },
        {
          onSuccess: (r) =>
            r.tempPassword &&
            setPasswords([{ name: p.name, login: p.mobile ?? p.email, tempPassword: r.tempPassword }]),
        },
      ),
    reset: setResetting,
  };
  const confirmReset = (p: OrgPerson) =>
    reset.mutate(p, {
      onSuccess: (r) =>
        setPasswords([{ name: p.name, login: p.mobile ?? p.email, tempPassword: r.tempPassword }]),
    });
  const runBulk = (body: BulkAction) =>
    bulk.mutate(body, {
      onSuccess: (r) => {
        toast.success(t('org.users.bulkDone', { count: r.updated }));
        if (r.skipped) toast.warning(t('org.users.bulkSkipped', { count: r.skipped }));
        if (r.passwords.length) setPasswords(r.passwords);
        setSelected(new Set());
      },
    });
  const ids = [...selected];
  const chip = (id: string, label: string, count: number) => (
    <button
      key={id}
      onClick={() => setDept(id)}
      className={cn(
        'flex h-9 shrink-0 items-center gap-2 rounded-pill border px-3.5 text-sm font-medium',
        dept === id
          ? 'border-ink bg-ink text-ink-foreground'
          : 'bg-card text-muted-foreground hover:text-foreground',
      )}
    >
      {label} <span className="tabular text-xs opacity-70">{count}</span>
    </button>
  );
  const effectiveView = phone ? 'cards' : view;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-control border bg-card px-3 sm:max-w-sm">
          <Search className="size-4 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('org.users.search')}
            className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
        </label>
        <div className="ml-auto flex items-center gap-2">
          {!phone && (
            <div className="flex rounded-control bg-muted p-1">
              {(['grid', 'cards'] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => (setView(v), safeStorage.set(VIEW_KEY, v))}
                  aria-pressed={view === v}
                  title={t(`org.users.view.${v}`)}
                  className={cn(
                    'grid size-8 place-items-center rounded-[calc(var(--radius)*0.5)]',
                    view === v ? 'bg-card shadow-sm' : 'text-muted-foreground',
                  )}
                >
                  {v === 'grid' ? <Rows3 className="size-4" /> : <LayoutGrid className="size-4" />}
                </button>
              ))}
            </div>
          )}
          {effectiveView === 'grid' && canHr && (
            <Select
              value={group}
              onChange={(e) => setGroup(e.target.value as 'team' | 'hr')}
              className="h-10 w-40 sm:h-10"
              aria-label={t('org.users.columns')}
            >
              <option value="team">{t('org.users.teamCols')}</option>
              <option value="hr">{t('org.users.hrCols')}</option>
            </Select>
          )}
          <Button variant="primary" onClick={() => setAdding(true)} aria-label={t('org.users.add')}>
            <UserPlus /> <span className="hidden sm:inline">{t('org.users.add')}</span>
          </Button>
        </div>
      </div>

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0">
        {chip('all', t('home.all'), all.length)}
        {(depts.data ?? []).map((d) => chip(d.id, d.name, d.peopleCount))}
        {chip(
          'none',
          t('org.users.notAssigned'),
          all.filter((p) => !p.mainDepartmentId && !p.alsoWorksIn.length).length,
        )}
        {newDept === null ? (
          <button
            onClick={() => setNewDept('')}
            className="flex h-9 shrink-0 items-center gap-1 rounded-pill border border-dashed px-3.5 text-sm text-muted-foreground"
          >
            <Plus className="size-3.5" /> {t('org.users.newDept')}
          </button>
        ) : (
          <form
            onSubmit={(e) => (
              e.preventDefault(),
              newDept.trim() && createDept.mutate(newDept.trim()),
              setNewDept(null)
            )}
          >
            <Input
              autoFocus
              value={newDept}
              onChange={(e) => setNewDept(e.target.value)}
              onBlur={() => setNewDept(null)}
              className="h-9 w-44 sm:h-9"
            />
          </form>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label className="flex items-center gap-2 text-muted-foreground">
          <input
            type="checkbox"
            className="size-4 accent-[var(--primary)]"
            checked={allTicked}
            onChange={() => setSelected(allTicked ? new Set() : new Set(visible.map((p) => p.id)))}
          />
          {t('org.users.tickAll', { count: visible.length })}
        </label>
        {selected.size > 0 && canAdmin && (
          <div className="flex w-full flex-wrap items-center gap-2 rounded-card border bg-card p-2 sm:w-auto">
            <span className="px-2 font-medium">{t('org.users.selected', { count: selected.size })}</span>
            <Select
              className="h-9 w-auto sm:h-9"
              value=""
              onChange={(e) =>
                e.target.value &&
                runBulk({
                  action: 'moveDepartment',
                  userIds: ids,
                  departmentId: e.target.value === 'none' ? null : e.target.value,
                })
              }
              aria-label={t('org.users.moveDept')}
            >
              <option value="">{t('org.users.moveDept')}</option>
              {(depts.data ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
              <option value="none">{t('org.users.notAssigned')}</option>
            </Select>
            <Select
              className="h-9 w-auto sm:h-9"
              value=""
              onChange={(e) =>
                e.target.value && runBulk({ action: 'setRole', userIds: ids, roleId: e.target.value })
              }
              aria-label={t('org.users.setRole')}
            >
              <option value="">{t('org.users.setRole')}</option>
              {(roles.data?.roles ?? []).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
            <Button size="sm" onClick={() => runBulk({ action: 'enableLogin', userIds: ids, enabled: true })}>
              {t('org.users.enableLogin')}
            </Button>
            <Button size="sm" onClick={() => toast.info(t('org.users.telegramSoon'))}>
              <Send /> {t('org.users.sendTelegram')}
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={() => setSelected(new Set())}
              aria-label={t('common.close')}
            >
              <X />
            </Button>
          </div>
        )}
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={Users}
          title={t('org.users.emptyTitle')}
          body={t('org.users.emptyBody')}
          action={
            <Button variant="primary" onClick={() => setAdding(true)}>
              <UserPlus /> {t('org.users.add')}
            </Button>
          }
        />
      ) : effectiveView === 'grid' ? (
        <UsersTable people={visible} depts={deptMap} group={group} a={actions} />
      ) : (
        <UserCards people={visible} depts={deptMap} a={actions} />
      )}

      <AddPeopleDialog
        key={dept}
        open={adding}
        onClose={() => setAdding(false)}
        departments={depts.data ?? []}
        designations={designations.data ?? []}
        roles={roles.data?.roles ?? []}
        people={all}
        defaultDept={dept !== 'all' && dept !== 'none' ? dept : undefined}
        onPasswords={setPasswords}
      />
      {editing && (
        <PersonSheet
          key={editing.id}
          person={editing}
          onClose={() => setEditing(null)}
          departments={depts.data ?? []}
          designations={designations.data ?? []}
          roles={roles.data?.roles ?? []}
          people={all}
          canHr={canHr}
          canAdmin={canAdmin}
        />
      )}
      <Confirm
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t('org.users.deleteTitle', { name: deleting?.name })}
        body={t('org.users.deleteBody')}
        confirm={t('org.delete')}
        danger
        onConfirm={() => deleting && remove.mutate(deleting)}
      />
      <Confirm
        open={!!resetting}
        onOpenChange={(o) => !o && setResetting(null)}
        title={t('org.users.resetTitle', { name: resetting?.name })}
        body={t('org.users.resetBody', { name: resetting?.name })}
        confirm={t('org.users.resetPassword')}
        danger
        onConfirm={() => resetting && confirmReset(resetting)}
      />
      <TempPasswords items={passwords} onClose={() => setPasswords([])} />
    </div>
  );
}
