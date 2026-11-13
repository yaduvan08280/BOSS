import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { USER_STATUS, type OrgDepartment, type OrgPerson } from '@mono/shared';
import { PhotoPicker } from '@/components/photo-picker';
import { Button } from '@/components/ui/button';
import { DateInput } from '@/components/ui/date-input';
import { Field, Select } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { patch, useBranches, useOrgMutation, useShifts, type Designation, type Role } from '../api';

type Props = {
  person: OrgPerson;
  onClose: () => void;
  departments: OrgDepartment[];
  designations: Designation[];
  roles: Role[];
  people: OrgPerson[];
  canHr: boolean;
  canAdmin: boolean;
};

const HR_FIELDS = [
  'doj',
  'dob',
  'biometricId',
  'bankName',
  'bankAccount',
  'ifsc',
  'pan',
  'aadhaarLast4',
  'salary',
] as const;

/** Edit one person: team details, "also works in", status and (HR only) HR details. */
export function PersonSheet({
  person,
  onClose,
  departments,
  designations,
  roles,
  people,
  canHr,
  canAdmin,
}: Props) {
  const { t } = useTranslation();
  const shifts = useShifts();
  const branches = useBranches();
  const [form, setForm] = useState<Record<string, string>>(() => ({
    name: person.name,
    mobile: person.mobile ?? '',
    email: person.email ?? '',
    mainDepartmentId: person.mainDepartmentId ?? '',
    designationId: person.designationId ?? '',
    roleId: person.roleId,
    reportsToId: person.reportsToId ?? '',
    branchId: person.branchId ?? '',
    shiftId: person.shiftId ?? '',
    status: person.status,
  }));
  const [also, setAlso] = useState<string[]>(person.alsoWorksIn);
  const [hr, setHr] = useState<Record<string, string>>(() =>
    Object.fromEntries(HR_FIELDS.map((k) => [k, person.hr?.[k] == null ? '' : String(person.hr[k])])),
  );
  const save = useOrgMutation((body: unknown) => patch(`/api/org/users/${person.id}`, body), {
    success: t('org.saved'),
  });

  const set = (k: string) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));
  const sel = (k: string, label: string, options: { id: string; name: string }[], empty = '—') => (
    <Field label={label}>
      <Select value={form[k] ?? ''} onChange={set(k)}>
        <option value="">{empty}</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </Select>
    </Field>
  );

  const submit = () => {
    const nul = (v: string | undefined) => v || null;
    const body: Record<string, unknown> = {
      name: form.name,
      mobile: nul(form.mobile),
      email: nul(form.email),
      mainDepartmentId: nul(form.mainDepartmentId),
      designationId: nul(form.designationId),
      reportsToId: nul(form.reportsToId),
      branchId: nul(form.branchId),
      shiftId: nul(form.shiftId),
      alsoWorksIn: also.filter((d) => d !== form.mainDepartmentId),
    };
    if (canAdmin) Object.assign(body, { roleId: form.roleId, status: form.status });
    if (canHr) {
      body.hr = Object.fromEntries(
        HR_FIELDS.map((k) => [k, k === 'salary' ? (hr[k] ? Number(hr[k]) : null) : hr[k] || null]),
      );
    }
    save.mutate(body, { onSuccess: onClose });
  };

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" title={person.name} description={`${person.code} · ${person.roleName}`}>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
          <PhotoPicker personId={person.id} name={person.name} url={person.avatarUrl} />
          <div className="text-sm text-muted-foreground">
            {person.loginEnabled
              ? t('org.users.loginOn', { id: person.mobile ?? person.email })
              : t('org.users.loginOff')}
          </div>
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t('org.name')} className="sm:col-span-2">
              <Input value={form.name ?? ''} onChange={set('name')} />
            </Field>
            <Field label={t('org.mobile')}>
              <Input inputMode="tel" value={form.mobile ?? ''} onChange={set('mobile')} />
            </Field>
            <Field label={t('org.email')}>
              <Input inputMode="email" value={form.email ?? ''} onChange={set('email')} />
            </Field>
            {sel('mainDepartmentId', t('org.users.mainDept'), departments, t('org.users.notAssigned'))}
            {sel('designationId', t('org.users.designation'), designations)}
            {sel(
              'reportsToId',
              t('org.users.reportsTo'),
              people.filter((p) => p.id !== person.id && p.status === 'ACTIVE'),
            )}
            {sel('branchId', t('org.users.branch'), branches.data ?? [])}
            {sel(
              'shiftId',
              t('org.users.shift'),
              (shifts.data ?? []).map((s) => ({ id: s.id, name: `${s.name} ${s.start}–${s.end}` })),
            )}
            {canAdmin && (
              <>
                <Field label={t('org.users.role')}>
                  <Select value={form.roleId} onChange={set('roleId')}>
                    {roles.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t('org.users.status')}>
                  <Select value={form.status} onChange={set('status')}>
                    {USER_STATUS.map((s) => (
                      <option key={s} value={s}>
                        {t(`org.status.${s}`)}
                      </option>
                    ))}
                  </Select>
                </Field>
              </>
            )}
          </section>
          <section>
            <div className="mb-2 text-sm font-medium">{t('org.users.alsoWorksIn')}</div>
            <div className="flex flex-wrap gap-1.5">
              {departments
                .filter((d) => d.id !== form.mainDepartmentId)
                .map((d) => {
                  const on = also.includes(d.id);
                  return (
                    <button
                      key={d.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setAlso(on ? also.filter((x) => x !== d.id) : [...also, d.id])}
                      className={cn(
                        'h-8 rounded-pill border px-3 text-xs font-medium',
                        on
                          ? 'border-transparent bg-accent-soft text-accent-soft-foreground'
                          : 'bg-card text-muted-foreground',
                      )}
                    >
                      {d.name}
                    </button>
                  );
                })}
            </div>
          </section>
          {canHr && (
            <section className="rounded-card border p-4">
              <div className="mb-3 text-sm font-semibold">{t('org.users.hrDetails')}</div>
              <div className="grid grid-cols-2 gap-3">
                {HR_FIELDS.map((k) => (
                  <Field key={k} label={t(`org.hr.${k}`)}>
                    {k === 'doj' || k === 'dob' ? (
                      // DD/MM/YYYY like every date in MONO (the joining date also starts their pay).
                      <DateInput
                        value={/^\d{4}-\d{2}-\d{2}$/.test(hr[k] ?? '') ? hr[k]! : ''}
                        onChange={(v) => setHr({ ...hr, [k]: v })}
                        aria-label={t(`org.hr.${k}`)}
                      />
                    ) : (
                      <Input
                        value={hr[k] ?? ''}
                        onChange={(e) => setHr({ ...hr, [k]: e.target.value })}
                        type={k === 'salary' ? 'number' : 'text'}
                        inputMode={k === 'aadhaarLast4' || k === 'salary' ? 'numeric' : undefined}
                        maxLength={k === 'aadhaarLast4' ? 4 : undefined}
                      />
                    )}
                  </Field>
                ))}
              </div>
            </section>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t px-5 py-3">
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={submit} disabled={save.isPending}>
            {save.isPending && <Loader2 className="animate-spin" />} {t('common.save')}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
