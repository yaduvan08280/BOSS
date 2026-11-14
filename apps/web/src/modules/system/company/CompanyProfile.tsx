import { BadgeCheck, Loader2, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { companyProfileSchema, INDIAN_STATES } from '@mono/shared';
import { ErrorState, PageSkeleton } from '@/components/page';
import { StatusChip } from '@/components/status-chip';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Select } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
  del,
  patch,
  post,
  put,
  useCompany,
  useOrgMutation,
  type CompanyProfile as Profile,
  type Contact,
} from '../api';

type Form = Record<keyof Omit<Profile, 'id'>, string>;
const EMPTY: Form = {
  name: '',
  legalName: '',
  city: '',
  state: '',
  ownerName: '',
  mobile: '',
  email: '',
  website: '',
  cin: '',
  gstin: '',
  pan: '',
};
type GstResult = {
  valid: boolean;
  reason?: string;
  pan?: string;
  stateName?: string;
  legalName: string | null;
  provider: string | null;
};

export function CompanyProfile() {
  const q = useCompany();
  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} error={q.error} />;
  return <ProfileForm key={q.data.profile.id} profile={q.data.profile} contacts={q.data.contacts} />;
}

const toForm = (profile: Profile): Form =>
  Object.fromEntries(
    Object.keys(EMPTY).map((k) => [k, (profile as Record<string, unknown>)[k] ?? '']),
  ) as Form;

function ProfileForm({ profile, contacts }: { profile: Profile; contacts: Contact[] }) {
  const { t } = useTranslation();
  const [form, setForm] = useState<Form>(() => toForm(profile));
  const [errors, setErrors] = useState<Partial<Record<keyof Form, string>>>({});
  const [gst, setGst] = useState<GstResult | null>(null);
  const save = useOrgMutation((body: unknown) => put('/api/org/company', body), { success: t('org.saved') });
  const verify = useOrgMutation((gstin: string) => post<GstResult>('/api/org/company/gst-verify', { gstin }));

  const set = (k: keyof Form) => (e: { target: { value: string } }) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setErrors((er) => ({ ...er, [k]: undefined }));
    if (k === 'gstin') setGst(null);
  };

  const onVerify = async () => {
    const r = await verify.mutateAsync(form.gstin);
    setGst(r);
    if (r.valid) {
      setForm((f) => ({
        ...f,
        pan: r.pan ?? f.pan,
        state: f.state || r.stateName || '',
        legalName: r.legalName ?? f.legalName,
      }));
    }
  };

  const onSave = () => {
    const parsed = companyProfileSchema.safeParse(form);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [i.path[0], i.message])));
      return;
    }
    save.mutate(parsed.data);
  };

  const text = (k: keyof Form, label: string, props: React.ComponentProps<'input'> = {}) => (
    <Field label={label} error={errors[k]}>
      <Input value={form[k]} onChange={set(k)} aria-invalid={!!errors[k]} {...props} />
    </Field>
  );

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_380px]">
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>{t('org.company.profile')}</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {text('name', `${t('org.company.tradingName')} *`)}
            {text('ownerName', `${t('org.company.ownerName')} *`)}
            {text('city', `${t('org.company.city')} *`)}
            <Field label={`${t('org.company.state')} *`} error={errors.state}>
              <Select value={form.state} onChange={set('state')} aria-invalid={!!errors.state}>
                <option value="">{t('org.choose')}</option>
                {INDIAN_STATES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </Select>
            </Field>
            {text('mobile', `${t('org.company.mobile')} *`, { inputMode: 'tel', placeholder: '98290 12345' })}
            {text('email', t('org.company.email'), { inputMode: 'email', placeholder: 'office@company.in' })}
            {text('website', t('org.company.website'), { placeholder: 'company.in' })}
            {text('cin', t('org.company.cin'), { className: 'font-mono uppercase' })}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-muted-foreground" /> {t('org.company.tax')}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="GSTIN" error={errors.gstin} className="sm:col-span-2">
              <div className="flex gap-2">
                <Input
                  value={form.gstin}
                  onChange={set('gstin')}
                  maxLength={15}
                  className="font-mono uppercase"
                  placeholder="08AAACG1234A1Z5"
                />
                <Button onClick={onVerify} disabled={form.gstin.trim().length !== 15 || verify.isPending}>
                  {verify.isPending ? <Loader2 className="animate-spin" /> : <BadgeCheck />}{' '}
                  {t('org.company.verify')}
                </Button>
              </div>
            </Field>
            {gst && (
              <div className="sm:col-span-2">
                {gst.valid ? (
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <StatusChip tone="ok">{t('org.company.gstValid', { state: gst.stateName })}</StatusChip>
                    {!gst.provider && (
                      <span className="text-muted-foreground">{t('org.company.gstOffline')}</span>
                    )}
                  </div>
                ) : (
                  <StatusChip tone="bad">{t(`org.company.gstBad.${gst.reason}`)}</StatusChip>
                )}
              </div>
            )}
            {text('legalName', t('org.company.legalName'))}
            {text('pan', 'PAN', { className: 'font-mono uppercase', maxLength: 10 })}
          </CardContent>
        </Card>
        <div className="flex justify-end">
          <Button variant="primary" size="lg" onClick={onSave} disabled={save.isPending}>
            {save.isPending && <Loader2 className="animate-spin" />} {t('common.save')}
          </Button>
        </div>
      </div>
      <Contacts contacts={contacts} />
    </div>
  );
}

function Contacts({ contacts }: { contacts: Contact[] }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState({ role: '', name: '', phone: '', email: '' });
  const add = useOrgMutation((body: typeof draft) => post('/api/org/contacts', body), {
    success: t('org.saved'),
  });
  const update = useOrgMutation(({ id, ...body }: Partial<Contact> & { id: string }) =>
    patch(`/api/org/contacts/${id}`, body),
  );
  const remove = useOrgMutation((id: string) => del(`/api/org/contacts/${id}`));
  return (
    <Card className="self-start">
      <CardHeader>
        <div>
          <CardTitle>{t('org.company.contacts')}</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">{t('org.company.contactsHint')}</p>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {contacts.map((c) => (
          <div key={c.id} className="grid grid-cols-[1fr_auto] gap-2 rounded-control border p-3">
            <div className="grid grid-cols-2 gap-2">
              <Input
                defaultValue={c.role}
                aria-label={t('org.company.contactRole')}
                onBlur={(e) => e.target.value !== c.role && update.mutate({ id: c.id, role: e.target.value })}
              />
              <Input
                defaultValue={c.name}
                aria-label={t('org.name')}
                onBlur={(e) => e.target.value !== c.name && update.mutate({ id: c.id, name: e.target.value })}
              />
              <Input
                defaultValue={c.phone ?? ''}
                inputMode="tel"
                aria-label={t('org.mobile')}
                onBlur={(e) =>
                  e.target.value !== (c.phone ?? '') && update.mutate({ id: c.id, phone: e.target.value })
                }
              />
              <Input
                defaultValue={c.email ?? ''}
                inputMode="email"
                aria-label={t('org.email')}
                onBlur={(e) =>
                  e.target.value !== (c.email ?? '') && update.mutate({ id: c.id, email: e.target.value })
                }
              />
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => remove.mutate(c.id)}
              aria-label={t('org.delete')}
            >
              <Trash2 />
            </Button>
          </div>
        ))}
        <form
          className="grid grid-cols-2 gap-2 rounded-control border border-dashed p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!draft.role || !draft.name) return;
            add.mutate(draft, { onSuccess: () => setDraft({ role: '', name: '', phone: '', email: '' }) });
          }}
        >
          <Input
            placeholder={t('org.company.contactRolePh')}
            value={draft.role}
            onChange={(e) => setDraft({ ...draft, role: e.target.value })}
          />
          <Input
            placeholder={t('org.name')}
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
          <Input
            placeholder={t('org.mobile')}
            inputMode="tel"
            value={draft.phone}
            onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
          />
          <Input
            placeholder={t('org.email')}
            inputMode="email"
            value={draft.email}
            onChange={(e) => setDraft({ ...draft, email: e.target.value })}
          />
          <Button type="submit" className="col-span-2" disabled={!draft.role || !draft.name || add.isPending}>
            <Plus /> {t('org.company.addContact')}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
