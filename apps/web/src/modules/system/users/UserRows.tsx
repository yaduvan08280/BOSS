import { Crown, KeyRound, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { OrgDepartment, OrgPerson } from '@mono/shared';
import { Avatar } from '@/components/brand';
import { StatusChip } from '@/components/status-chip';
import { Button } from '@/components/ui/button';
import { Checkbox, Switch } from '@/components/ui/form';
import { cn } from '@/lib/utils';

export type RowActions = {
  selected: Set<string>;
  toggle: (id: string) => void;
  open: (p: OrgPerson) => void;
  setLogin: (p: OrgPerson, on: boolean) => void;
  /** Asks first (Confirm in UsersTab); never offered on the signed-in person's own row. */
  reset: (p: OrgPerson) => void;
  remove: (p: OrgPerson) => void;
  canAdmin: boolean;
  /** The signed-in person: they change their own password in Profile, not here. */
  meId: string;
};

const TONE = { ACTIVE: 'ok', INACTIVE: 'neutral', LEFT: 'bad' } as const;
const HR_COLS = ['doj', 'dob', 'biometricId', 'bankName', 'pan', 'aadhaarLast4', 'salary'] as const;

function DeptChips({ ids, depts }: { ids: string[]; depts: Map<string, OrgDepartment> }) {
  return (
    <div className="flex flex-wrap gap-1">
      {ids.map((id) => (
        <span key={id} className="rounded-pill bg-muted px-2 py-0.5 text-[11px] font-medium">
          {depts.get(id)?.name ?? '?'}
        </span>
      ))}
    </div>
  );
}

/**
 * Key icon. Someone else: asks before resetting (it signs them out). Yourself: no reset here — it would
 * replace your own password with a one-time one — so the icon leads to Profile → Change password.
 */
function PasswordButton({ p, a }: { p: OrgPerson; a: RowActions }) {
  const { t } = useTranslation();
  if (p.id === a.meId)
    return (
      <Button asChild variant="ghost" size="icon-sm" title={t('org.users.ownPassword')}>
        <Link to="/account" aria-label={t('org.users.ownPassword')}>
          <KeyRound />
        </Link>
      </Button>
    );
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      title={t('org.users.resetPassword')}
      aria-label={t('org.users.resetPasswordOf', { name: p.name })}
      onClick={() => a.reset(p)}
    >
      <KeyRound />
    </Button>
  );
}

/** Grid view: a real table on desktop (Team or HR column group). */
export function UsersTable({
  people,
  depts,
  group,
  a,
}: {
  people: OrgPerson[];
  depts: Map<string, OrgDepartment>;
  group: 'team' | 'hr';
  a: RowActions;
}) {
  const { t } = useTranslation();
  const head = (k: string) => (
    <th key={k} className="whitespace-nowrap px-3 py-2.5 font-medium">
      {k}
    </th>
  );
  return (
    <div className="overflow-x-auto rounded-card border bg-card">
      <table className="w-full min-w-[1100px] text-sm">
        <thead className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
          <tr>
            <th className="w-10 px-3" />
            {head('#')}
            {head(t('org.users.code'))}
            {head(t('org.name'))}
            {group === 'team'
              ? [
                  t('org.users.mainDept'),
                  t('org.users.role'),
                  t('org.users.reportsTo'),
                  t('org.users.status'),
                  t('org.users.alsoWorksIn'),
                  'HOD',
                  t('org.users.login'),
                  t('org.users.loginId'),
                  '',
                ].map(head)
              : HR_COLS.map((k) => head(t(`org.hr.${k}`)))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {people.map((p, i) => (
            <tr key={p.id} className={cn('hover:bg-muted/40', a.selected.has(p.id) && 'bg-accent-soft/40')}>
              <td className="px-3">
                <Checkbox
                  checked={a.selected.has(p.id)}
                  onChange={() => a.toggle(p.id)}
                  aria-label={p.name}
                />
              </td>
              <td className="tabular px-3 text-muted-foreground">{i + 1}</td>
              <td className="px-3 font-mono text-xs">{p.code}</td>
              <td className="px-3 py-2">
                <button onClick={() => a.open(p)} className="flex items-center gap-2.5 text-left">
                  <Avatar name={p.name} url={p.avatarUrl} className="size-8" />
                  <span>
                    <span className="block font-medium">{p.name}</span>
                    <span className="block text-xs text-muted-foreground">{p.designationName ?? '—'}</span>
                  </span>
                </button>
              </td>
              {group === 'team' ? (
                <>
                  <td className="px-3">
                    {(p.mainDepartmentId && depts.get(p.mainDepartmentId)?.name) || (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3">{p.roleName}</td>
                  <td className="px-3">{p.reportsToName ?? '—'}</td>
                  <td className="px-3">
                    <StatusChip tone={TONE[p.status]}>{t(`org.status.${p.status}`)}</StatusChip>
                  </td>
                  <td className="px-3">
                    <DeptChips ids={p.alsoWorksIn} depts={depts} />
                  </td>
                  <td className="px-3">
                    {p.hodOf.length > 0 && (
                      <Crown className="size-4 text-accent-soft-foreground" aria-label="HOD" />
                    )}
                  </td>
                  <td className="px-3">
                    <Switch
                      checked={p.loginEnabled}
                      disabled={!a.canAdmin}
                      onCheckedChange={(on) => a.setLogin(p, on)}
                      aria-label={t('org.users.login')}
                    />
                  </td>
                  <td className="px-3 text-xs">{p.mobile ?? p.email ?? '—'}</td>
                  <td className="px-3">
                    {a.canAdmin && (
                      <div className="flex">
                        <PasswordButton p={p} a={a} />
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          title={t('org.delete')}
                          onClick={() => a.remove(p)}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    )}
                  </td>
                </>
              ) : (
                HR_COLS.map((k) => (
                  <td key={k} className="tabular px-3 text-xs">
                    {p.hr?.[k] == null || p.hr[k] === '' ? '—' : String(p.hr[k])}
                  </td>
                ))
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Cards view (always used on phones). */
export function UserCards({
  people,
  depts,
  a,
}: {
  people: OrgPerson[];
  depts: Map<string, OrgDepartment>;
  a: RowActions;
}) {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {people.map((p) => (
        <div
          key={p.id}
          className={cn(
            'flex flex-col gap-3 rounded-card border bg-card p-3.5',
            a.selected.has(p.id) && 'ring-2 ring-ring/40',
          )}
        >
          <div className="flex items-start gap-3">
            <Checkbox
              className="mt-2.5"
              checked={a.selected.has(p.id)}
              onChange={() => a.toggle(p.id)}
              aria-label={p.name}
            />
            <button onClick={() => a.open(p)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
              <Avatar name={p.name} url={p.avatarUrl} className="size-10" />
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 font-medium">
                  <span className="truncate">{p.name}</span>
                  {p.hodOf.length > 0 && (
                    <Crown className="size-3.5 shrink-0 text-accent-soft-foreground" aria-label="HOD" />
                  )}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  <span className="font-mono">{p.code}</span> · {p.designationName ?? p.roleName}
                </span>
              </span>
            </button>
            <StatusChip tone={TONE[p.status]}>{t(`org.status.${p.status}`)}</StatusChip>
          </div>
          <div className="flex flex-wrap items-center gap-1 text-xs">
            <span className="font-medium">
              {(p.mainDepartmentId && depts.get(p.mainDepartmentId)?.name) || t('org.users.notAssigned')}
            </span>
            {p.alsoWorksIn.length > 0 && <DeptChips ids={p.alsoWorksIn} depts={depts} />}
          </div>
          <div className="flex items-center gap-2 border-t pt-3 text-xs">
            <Switch
              checked={p.loginEnabled}
              disabled={!a.canAdmin}
              onCheckedChange={(on) => a.setLogin(p, on)}
              aria-label={t('org.users.login')}
            />
            <span className="min-w-0 flex-1 truncate text-muted-foreground">
              {p.loginEnabled ? (p.mobile ?? p.email) : t('org.users.loginOff')}
            </span>
            {a.canAdmin && (
              <>
                <PasswordButton p={p} a={a} />
                <Button variant="ghost" size="icon-sm" title={t('org.delete')} onClick={() => a.remove(p)}>
                  <Trash2 />
                </Button>
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
