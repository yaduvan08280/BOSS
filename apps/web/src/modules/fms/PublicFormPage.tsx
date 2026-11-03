import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { FlowField } from '@mono/shared';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { ApiError, api } from '@/lib/api';
import { FieldsForm } from './FieldsForm';
import { toPayload, type Values } from './payload';

type Form = {
  company: string;
  appName: string | null;
  logoUrl: string | null;
  flow: string;
  runName: string;
  fields: FlowField[];
  challenge: { question: string; token: string };
};

/** The public "share a form" page: no login; a sum instead of a third-party captcha. */
export function PublicFormPage() {
  const { t } = useTranslation();
  const { token } = useParams();
  const q = useQuery({
    queryKey: ['public-form', token],
    queryFn: () => api<Form>(`/api/public/forms/${token}`),
    retry: false,
  });
  const [values, setValues] = useState<Values>({});
  const [answer, setAnswer] = useState('');
  const [honey, setHoney] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [challenge, setChallenge] = useState<Form['challenge'] | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const form = q.data;
  const c = challenge ?? form?.challenge;

  const submit = async () => {
    if (!form || !c) return;
    setBusy(true);
    setMessage(null);
    try {
      const r = await api<{ ok: boolean; number: number | null }>(`/api/public/forms/${token}`, {
        method: 'POST',
        body: {
          data: toPayload(form.fields, values, 'Asia/Kolkata'),
          challenge: c.token,
          answer: Number(answer),
          website: honey || undefined,
        },
      });
      setDone(r.number ?? 0);
    } catch (e) {
      const details = (e instanceof ApiError ? e.details : null) as {
        fields?: Record<string, string>;
        challenge?: Form['challenge'];
      } | null;
      setErrors(details?.fields ?? {});
      if (details?.challenge) {
        setChallenge(details.challenge);
        setAnswer('');
      }
      setMessage(e instanceof Error ? e.message : t('common.somethingWrong'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-dvh bg-background px-4 py-8">
      <div className="mx-auto max-w-2xl space-y-5">
        {q.isError ? (
          <div className="rounded-card border bg-card p-6 text-center">
            <p className="font-semibold">{t('fms.pub.notFound')}</p>
          </div>
        ) : !form ? (
          <Loader2 className="mx-auto animate-spin" />
        ) : done !== null ? (
          <div className="space-y-2 rounded-card border bg-card p-8 text-center">
            <CheckCircle2 className="mx-auto size-10 text-status-ok-fg" />
            <p className="text-lg font-semibold">{t('fms.pub.thanks')}</p>
            <p className="text-sm text-muted-foreground">
              {done ? t('fms.pub.yourNumber', { run: form.runName, n: done }) : t('fms.pub.received')}
            </p>
          </div>
        ) : (
          <div className="space-y-5 rounded-card border bg-card p-5 sm:p-7">
            <div className="flex items-center gap-3">
              {form.logoUrl && (
                <img src={form.logoUrl} alt="" className="size-10 rounded-control object-contain" />
              )}
              <div>
                <div className="text-xs text-muted-foreground">{form.company}</div>
                <h1 className="text-lg font-semibold">{form.flow}</h1>
              </div>
            </div>
            <FieldsForm
              fields={form.fields}
              values={values}
              onChange={setValues}
              errors={errors}
              publicForm
            />
            {/* Honeypot: hidden from people, irresistible to bots. */}
            <input
              tabIndex={-1}
              autoComplete="off"
              aria-hidden="true"
              className="absolute -left-[9999px] size-px opacity-0"
              name="website"
              value={honey}
              onChange={(e) => setHoney(e.target.value)}
            />
            {c && (
              <Field label={t('fms.pub.sum', { q: c.question })}>
                <Input
                  inputMode="numeric"
                  className="w-28"
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                />
              </Field>
            )}
            {message && <p className="text-sm text-status-bad-fg">{message}</p>}
            <Button variant="primary" size="lg" disabled={busy || !answer} onClick={() => void submit()}>
              {busy && <Loader2 className="animate-spin" />} {t('fms.pub.send')}
            </Button>
          </div>
        )}
        <p className="text-center text-xs text-muted-foreground">{form?.appName ?? 'MONO'}</p>
      </div>
    </div>
  );
}
