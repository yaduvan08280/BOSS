import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { changePasswordSchema, type ChangePasswordInput, type Me } from '@mono/shared';
import { Avatar } from '@/components/brand';
import { PageHeader } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FieldError, Input, Label } from '@/components/ui/input';
import { api, ApiError } from '@/lib/api';
import { ME_KEY } from '@/modules/auth/session';

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex justify-between gap-4 border-b py-3 text-sm last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate font-medium">{value ?? '—'}</span>
    </div>
  );
}

export function ChangePasswordCard({ onDone }: { onDone?: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);
  const form = useForm<ChangePasswordInput>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: '', newPassword: '' },
  });

  const submit = async (values: ChangePasswordInput) => {
    setSaving(true);
    try {
      await api('/api/auth/change-password', { method: 'POST', body: values });
      form.reset();
      toast.success(t('auth.passwordChanged'));
      await qc.invalidateQueries({ queryKey: ME_KEY });
      onDone?.();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t('common.somethingWrong');
      form.setError('currentPassword', { message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('auth.changePassword')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={form.handleSubmit(submit)} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="current">{t('auth.currentPassword')}</Label>
            <Input
              id="current"
              type="password"
              autoComplete="current-password"
              {...form.register('currentPassword')}
            />
            <FieldError>{form.formState.errors.currentPassword?.message}</FieldError>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new">{t('auth.newPassword')}</Label>
            <Input id="new" type="password" autoComplete="new-password" {...form.register('newPassword')} />
            <p className="text-xs text-muted-foreground">{t('auth.newPasswordHint')}</p>
            <FieldError>{form.formState.errors.newPassword?.message}</FieldError>
          </div>
          <Button type="submit" variant="primary" disabled={saving}>
            {saving && <Loader2 className="animate-spin" />}
            {t('auth.changePassword')}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export function AccountPage({ me }: { me: Me }) {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={t('account.title')} subtitle={t('account.subtitle')} />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardContent className="pt-5">
            <div className="mb-3 flex items-center gap-3">
              <Avatar name={me.user.name} url={me.user.avatarUrl} className="size-12 text-sm" />
              <div className="min-w-0">
                <div className="truncate font-semibold">{me.user.name}</div>
                <div className="text-sm text-muted-foreground">{me.company.name}</div>
              </div>
            </div>
            <Row label={t('account.code')} value={me.user.code} />
            <Row label={t('account.role')} value={me.user.roleName} />
            <Row label={t('account.mobile')} value={me.user.mobile} />
            <Row label={t('account.email')} value={me.user.email} />
          </CardContent>
        </Card>
        <ChangePasswordCard />
      </div>
    </div>
  );
}
