import { zodResolver } from '@hookform/resolvers/zod';
import { Building2, Check, Eye, EyeOff, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Navigate, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { loginSchema, type LoginInput } from '@mono/shared';
import { BrandMark } from '@/components/brand';
import { Button } from '@/components/ui/button';
import { FieldError, Input, Label } from '@/components/ui/input';
import { ApiError } from '@/lib/api';
import { setLanguage } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { useLogin, useMe } from './session';

type Company = { id: string; name: string };

export function LoginPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const me = useMe();
  const login = useLogin();
  const [showPassword, setShowPassword] = useState(false);
  const [companies, setCompanies] = useState<Company[] | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { identifier: '', password: '' },
  });

  if (me.data) return <Navigate to="/" replace />;

  const submit = async (values: LoginInput) => {
    setFormError(null);
    try {
      await login.mutateAsync(values);
      navigate('/', { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'CHOOSE_COMPANY') {
        setCompanies((err.details as { companies: Company[] }).companies);
        return;
      }
      setFormError(err instanceof ApiError ? err.message : t('common.somethingWrongBody'));
    }
  };

  const chooseCompany = (companyId: string) => void submit({ ...form.getValues(), companyId });

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      <section className="relative hidden overflow-hidden bg-sidebar p-12 text-sidebar-foreground lg:flex lg:flex-col">
        <div className="flex items-center gap-3">
          <BrandMark appName="MONO" className="size-11 text-lg" />
          <div>
            <div className="text-lg font-bold tracking-tight">MONO</div>
            <div className="text-[11px] uppercase tracking-[0.14em] text-sidebar-muted">
              Business operating system
            </div>
          </div>
        </div>
        <div className="mt-auto max-w-lg">
          <h1 className="text-[40px] font-semibold leading-[1.1] tracking-tight">{t('auth.heroTitle')}</h1>
          <p className="mt-4 text-base text-sidebar-muted">{t('auth.heroBody')}</p>
          <ul className="mt-8 space-y-3">
            {(['heroPoint1', 'heroPoint2', 'heroPoint3'] as const).map((k) => (
              <li key={k} className="flex items-center gap-3 text-sm">
                <span className="grid size-6 place-items-center rounded-full bg-sidebar-active text-sidebar-active-foreground">
                  <Check className="size-3.5" />
                </span>
                {t(`auth.${k}`)}
              </li>
            ))}
          </ul>
        </div>
        <div className="mt-12 grid max-w-lg grid-cols-3 gap-3" aria-hidden>
          {[
            ['18', 'Pending'],
            ['4', 'Overdue'],
            ['86%', 'On time'],
          ].map(([v, l], i) => (
            <div
              key={l}
              className={cn(
                'rounded-card border border-sidebar-border p-4',
                i === 0 && 'border-sidebar-active bg-sidebar-active text-sidebar-active-foreground',
              )}
            >
              <div className={cn('text-xs', i === 0 ? 'opacity-80' : 'text-sidebar-muted')}>{l}</div>
              <div className="tabular mt-1 text-2xl font-semibold">{v}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="flex flex-col px-5 py-8 sm:px-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5 lg:invisible">
            <BrandMark appName="MONO" />
            <span className="text-lg font-bold tracking-tight">MONO</span>
          </div>
          <div className="inline-flex rounded-control bg-muted p-1 text-[13px]">
            {(['en', 'hi'] as const).map((lng) => (
              <button
                key={lng}
                onClick={() => void setLanguage(lng)}
                className={cn(
                  'h-8 rounded-[calc(var(--radius)*0.5)] px-3 font-medium',
                  i18n.language === lng ? 'bg-card shadow-sm' : 'text-muted-foreground',
                )}
              >
                {lng === 'en' ? 'English' : 'हिंदी'}
              </button>
            ))}
          </div>
        </div>

        <div className="mx-auto my-auto w-full max-w-sm py-10">
          {companies ? (
            <div>
              <h2 className="text-2xl font-semibold tracking-tight">{t('auth.chooseCompany')}</h2>
              <p className="mt-1.5 text-sm text-muted-foreground">{t('auth.chooseCompanyHint')}</p>
              <div className="mt-6 space-y-2">
                {companies.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => chooseCompany(c.id)}
                    disabled={login.isPending}
                    className="flex h-14 w-full items-center gap-3 rounded-card border bg-card px-4 text-left font-medium hover:bg-muted"
                  >
                    <Building2 className="size-5 text-muted-foreground" />
                    {c.name}
                  </button>
                ))}
              </div>
              <Button variant="link" className="mt-4" onClick={() => setCompanies(null)}>
                {t('common.back')}
              </Button>
            </div>
          ) : (
            <form onSubmit={form.handleSubmit(submit)} noValidate>
              <h2 className="text-2xl font-semibold tracking-tight">{t('auth.title')}</h2>
              <p className="mt-1.5 text-sm text-muted-foreground">{t('auth.subtitle')}</p>
              <div className="mt-7 space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="identifier">{t('auth.identifier')}</Label>
                  <Input
                    id="identifier"
                    autoComplete="username"
                    inputMode="email"
                    autoFocus
                    placeholder={t('auth.identifierPlaceholder')}
                    aria-invalid={!!form.formState.errors.identifier}
                    {...form.register('identifier')}
                  />
                  <FieldError>{form.formState.errors.identifier?.message}</FieldError>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="password">{t('auth.password')}</Label>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      className="pr-12"
                      aria-invalid={!!form.formState.errors.password}
                      {...form.register('password')}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((s) => !s)}
                      className="absolute inset-y-0 right-0 grid w-11 place-items-center text-muted-foreground"
                      aria-label={showPassword ? t('auth.hide') : t('auth.show')}
                    >
                      {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                  <FieldError>{form.formState.errors.password?.message}</FieldError>
                </div>
                {formError && (
                  <div
                    role="alert"
                    className="rounded-control bg-status-bad-bg px-3 py-2.5 text-sm text-status-bad-fg"
                  >
                    {formError}
                  </div>
                )}
                <Button
                  type="submit"
                  variant="primary"
                  size="lg"
                  className="w-full"
                  disabled={login.isPending}
                >
                  {login.isPending && <Loader2 className="animate-spin" />}
                  {login.isPending ? t('auth.signingIn') : t('auth.submit')}
                </Button>
              </div>
              <p className="mt-6 text-center text-xs text-muted-foreground">{t('auth.forgot')}</p>
            </form>
          )}
        </div>
      </section>
    </div>
  );
}
