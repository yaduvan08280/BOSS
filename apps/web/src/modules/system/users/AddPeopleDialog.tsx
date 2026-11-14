import { ClipboardPaste, Loader2, UserPlus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { parsePeopleList, type OrgDepartment, type OrgPerson } from '@mono/shared';
import { personLabel } from '@/lib/people';
import { StatusChip } from '@/components/status-chip';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Field, Select, Textarea } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { post, useBranches, useOrgMutation, type Designation, type Role } from '../api';
import type { TempPassword } from './TempPasswords';

type Props = {
  open: boolean;
  onClose: () => void;
  departments: OrgDepartment[];
  designations: Designation[];
  roles: Role[];
  people: OrgPerson[];
  defaultDept?: string;
  onPasswords: (p: TempPassword[]) => void;
};

const EMPTY = {
  name: '',
  mobile: '',
  email: '',
  mainDepartmentId: '',
  designationId: '',
  roleId: '',
  reportsToId: '',
  branchId: '',
  loginEnabled: false,
};

export function AddPeopleDialog({
  open,
  onClose,
  departments,
  designations,
  roles,
  people,
  defaultDept,
  onPasswords,
}: Props) {
  const { t } = useTranslation();
  const branches = useBranches().data ?? [];
  const [mode, setMode] = useState<'one' | 'paste'>('one');
  const [form, setForm] = useState({ ...EMPTY, mainDepartmentId: defaultDept ?? '' });
  const [text, setText] = useState('');
  const [serverLines, setServerLines] = useState<Record<number, string>>({});
  const rows = useMemo(() => parsePeopleList(text), [text]);
  const deptNames = new Set(departments.map((d) => d.name.toLowerCase()));
  const desigNames = new Set(designations.map((d) => d.name.toLowerCase()));

  const createOne = useOrgMutation(
    (body: typeof form) =>
      post<{ person: OrgPerson; tempPassword: string | null }>('/api/org/users', {
        ...body,
        mobile: body.mobile || null,
        email: body.email || null,
        mainDepartmentId: body.mainDepartmentId || null,
        designationId: body.designationId || null,
        reportsToId: body.reportsToId || null,
        branchId: body.branchId || null,
        roleId: body.roleId || undefined,
      }),
    { success: (r) => t('org.users.personAdded', { name: r.person.name }) },
  );
  const createMany = useOrgMutation(
    (people: unknown) =>
      post<{ created: number; newDepartments: string[] }>('/api/org/users/bulk', {
        people,
        createMissing: true,
        branchId: form.branchId || null,
      }),
    { silentError: true, success: (r) => t('org.users.imported', { count: r.created }) },
  );

  // A single add closes the dialog (like a pasted list does), so nothing is left open behind the
  // one-time password. Adding many people at once is what "Paste a list" is for.
  const submitOne = () =>
    createOne.mutate(form, {
      onSuccess: (r) => {
        setForm({ ...EMPTY, mainDepartmentId: form.mainDepartmentId, branchId: form.branchId });
        onClose();
        if (r.tempPassword)
          onPasswords([
            { name: r.person.name, login: r.person.mobile ?? r.person.email, tempPassword: r.tempPassword },
          ]);
      },
    });

  const valid = rows.length > 0 && rows.every((r) => r.errors.length === 0);
  const submitPaste = () => {
    setServerLines({});
    createMany.mutate(
      rows.map(({ line: _l, errors: _e, ...p }) => p),
      {
        onSuccess: () => {
          setText('');
          onClose();
        },
        onError: (err) => {
          const lines =
            err instanceof ApiError
              ? (err.details as { lines?: { index: number; message: string }[] })?.lines
              : undefined;
          if (lines) setServerLines(Object.fromEntries(lines.map((l) => [l.index, l.message])));
        },
      },
    );
  };

  const tab = (m: typeof mode, icon: React.ReactNode, label: string) => (
    <button
      onClick={() => setMode(m)}
      className={cn(
        'flex h-9 flex-1 items-center justify-center gap-2 rounded-[calc(var(--radius)*0.5)] text-sm font-medium',
        mode === m ? 'bg-card shadow-sm' : 'text-muted-foreground',
      )}
    >
      {icon} {label}
    </button>
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={t('org.users.add')}
      wide
      footer={
        mode === 'one' ? (
          <Button
            variant="primary"
            disabled={form.name.trim().length < 2 || createOne.isPending}
            onClick={submitOne}
          >
            {createOne.isPending && <Loader2 className="animate-spin" />} {t('org.users.addPerson')}
          </Button>
        ) : (
          <Button variant="primary" disabled={!valid || createMany.isPending} onClick={submitPaste}>
            {createMany.isPending && <Loader2 className="animate-spin" />}{' '}
            {t('org.users.importN', { count: rows.length })}
          </Button>
        )
      }
    >
      <div className="mb-4 flex rounded-control bg-muted p-1">
        {tab('one', <UserPlus className="size-4" />, t('org.users.oneByOne'))}
        {tab('paste', <ClipboardPaste className="size-4" />, t('org.users.pasteList'))}
      </div>
      {mode === 'one' ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={`${t('org.name')} *`} className="sm:col-span-2">
            <Input
              autoFocus
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Sandeep Pal"
            />
          </Field>
          <Field label={t('org.mobile')}>
            <Input
              inputMode="tel"
              value={form.mobile}
              onChange={(e) => setForm({ ...form, mobile: e.target.value })}
              placeholder="98290 12345"
            />
          </Field>
          <Field label={t('org.email')}>
            <Input
              inputMode="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </Field>
          <Field label={t('org.users.mainDept')}>
            <Select
              value={form.mainDepartmentId}
              onChange={(e) => setForm({ ...form, mainDepartmentId: e.target.value })}
            >
              <option value="">{t('org.users.notAssigned')}</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('org.users.designation')}>
            <Select
              value={form.designationId}
              onChange={(e) => setForm({ ...form, designationId: e.target.value })}
            >
              <option value="">—</option>
              {designations.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('org.users.role')}>
            <Select value={form.roleId} onChange={(e) => setForm({ ...form, roleId: e.target.value })}>
              <option value="">{roles.find((r) => r.key === 'MEMBER')?.name ?? 'Member'}</option>
              {roles
                .filter((r) => r.key !== 'MEMBER')
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label={t('org.users.reportsTo')}>
            <Select
              value={form.reportsToId}
              onChange={(e) => setForm({ ...form, reportsToId: e.target.value })}
            >
              <option value="">—</option>
              {people
                .filter((p) => p.status === 'ACTIVE')
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {personLabel(p)}
                  </option>
                ))}
            </Select>
          </Field>
          {branches.length > 0 && (
            <Field label={t('org.place.branch')}>
              <Select
                value={form.branchId}
                onChange={(e) => setForm({ ...form, branchId: e.target.value })}
                aria-label={t('org.place.branch')}
              >
                <option value="">{branches.length === 1 ? branches[0]!.name : t('org.place.none')}</option>
                {branches.length > 1 &&
                  branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
              </Select>
            </Field>
          )}
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <Checkbox
              checked={form.loginEnabled}
              onChange={(e) => setForm({ ...form, loginEnabled: e.target.checked })}
            />
            {t('org.users.giveLogin')}
          </label>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{t('org.users.pasteHint')}</p>
          {branches.length > 1 && (
            <Field label={t('org.place.branch')}>
              <Select
                value={form.branchId}
                onChange={(e) => setForm({ ...form, branchId: e.target.value })}
                aria-label={t('org.place.branch')}
              >
                <option value="">{branches.length === 1 ? branches[0]!.name : t('org.place.none')}</option>
                {branches.length > 1 &&
                  branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
              </Select>
            </Field>
          )}
          <Textarea
            autoFocus
            value={text}
            onChange={(e) => (setText(e.target.value), setServerLines({}))}
            placeholder={'Sandeep Pal\t98290 12345\tsandeep@ggm.in\tMaintenance\tFitter'}
            aria-label={t('org.users.pasteList')}
          />
          {rows.length > 0 && (
            <div className="overflow-x-auto rounded-control border">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
                  <tr>
                    {[
                      '#',
                      t('org.name'),
                      t('org.mobile'),
                      t('org.email'),
                      t('org.users.dept'),
                      t('org.users.designation'),
                    ].map((h) => (
                      <th key={h} className="px-3 py-2 font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map((r, i) => {
                    const errors = [...r.errors, ...(serverLines[i] ? [serverLines[i]] : [])];
                    return (
                      <tr key={r.line} className={errors.length ? 'bg-status-bad-bg/40' : undefined}>
                        <td className="tabular px-3 py-2 text-muted-foreground">{r.line}</td>
                        <td className="px-3 py-2">
                          {r.name || '—'}
                          {errors.map((e) => (
                            <div key={e} className="text-xs text-status-bad-fg">
                              {e}
                            </div>
                          ))}
                        </td>
                        <td className="tabular px-3 py-2">{r.mobile ?? '—'}</td>
                        <td className="px-3 py-2">{r.email ?? '—'}</td>
                        <td className="px-3 py-2">
                          {r.department ?? '—'}{' '}
                          {r.department && !deptNames.has(r.department.toLowerCase()) && (
                            <StatusChip tone="info">{t('org.new')}</StatusChip>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {r.designation ?? '—'}{' '}
                          {r.designation && !desigNames.has(r.designation.toLowerCase()) && (
                            <StatusChip tone="info">{t('org.new')}</StatusChip>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}
