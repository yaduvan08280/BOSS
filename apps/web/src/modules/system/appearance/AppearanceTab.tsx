import { useQuery } from '@tanstack/react-query';
import { ImageUp, Loader2, TriangleAlert, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { SEED_POOL, seedClashesWithStatus, THEME_PRESETS, type AppearanceInput } from '@mono/shared';
import { BrandMark } from '@/components/brand';
import { ErrorState, KpiTile, PageSkeleton } from '@/components/page';
import { StatusChip } from '@/components/status-chip';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Select, Switch } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { applyTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { useMe } from '@/modules/auth/session';
import { put, useOrgMutation } from '../api';

async function uploadLogo(file: File): Promise<string> {
  const body = new FormData();
  body.append('file', file);
  const res = await fetch('/api/files', { method: 'POST', body, credentials: 'same-origin' });
  const json = (await res.json()) as { id?: string; error?: { message: string } };
  if (!res.ok || !json.id) throw new Error(json.error?.message ?? 'Upload failed');
  return json.id;
}

/** Company look: theme from one colour, logo, app name, defaults (CLAUDE.md §3.1, §4.2 Appearance). */
export function AppearanceTab() {
  const q = useQuery({
    queryKey: ['org', 'appearance'],
    queryFn: () => api<AppearanceInput>('/api/org/appearance'),
  });
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  if (!q.data) return <PageSkeleton />;
  // Remount only when the saved look really changes, so a background refetch never wipes edits.
  return <AppearanceForm key={JSON.stringify(q.data)} saved={q.data} />;
}

function AppearanceForm({ saved }: { saved: AppearanceInput }) {
  const { t } = useTranslation();
  const me = useMe().data!;
  const [form, setForm] = useState<AppearanceInput>(saved);
  const [uploading, setUploading] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const save = useOrgMutation((body: AppearanceInput) => put('/api/org/appearance', body), {
    success: t('org.saved'),
  });

  // Live preview on the whole app while editing; put the saved look back when leaving.
  useEffect(() => {
    applyTheme(form.theme, me.user.themeMode);
  }, [form, me.user.themeMode]);
  const latest = useRef(me);
  useEffect(() => {
    latest.current = me;
  }, [me]);
  useEffect(() => () => applyTheme(latest.current.company.theme, latest.current.user.themeMode), []);

  const theme = form.theme;
  const setTheme = (patch: Partial<typeof theme>) => setForm({ ...form, theme: { ...theme, ...patch } });
  const clash = seedClashesWithStatus(theme.seed);
  const dirty = JSON.stringify(form) !== JSON.stringify(saved);

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setUploading(true);
    try {
      const id = await uploadLogo(f);
      setForm({ ...form, logoFileId: id });
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_360px]">
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>{t('org.look.theme')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex flex-wrap gap-2">
              {Object.entries(THEME_PRESETS).map(([key, preset]) => (
                <button
                  key={key}
                  onClick={() => setForm({ ...form, theme: preset })}
                  className="flex h-9 items-center gap-2 rounded-pill border bg-card pl-1.5 pr-3 text-sm font-medium hover:bg-muted"
                >
                  <span className="size-6 rounded-full border" style={{ background: preset.seed }} />{' '}
                  {t(`org.look.preset.${key}`)}
                </button>
              ))}
            </div>
            <div>
              <div className="mb-2 text-sm font-medium">{t('dev.seed')}</div>
              <div className="flex flex-wrap gap-2">
                {SEED_POOL.map((c) => (
                  <button
                    key={c}
                    onClick={() => setTheme({ seed: c })}
                    style={{ background: c }}
                    aria-label={c}
                    className={cn(
                      'size-8 rounded-full border border-black/10 transition-transform hover:scale-110',
                      theme.seed.toUpperCase() === c &&
                        'ring-2 ring-foreground ring-offset-2 ring-offset-card',
                    )}
                  />
                ))}
                <label
                  className="relative grid size-8 cursor-pointer place-items-center overflow-hidden rounded-full border bg-[conic-gradient(red,yellow,lime,cyan,blue,magenta,red)]"
                  title={t('org.look.anyColour')}
                >
                  <input
                    type="color"
                    value={theme.seed.toLowerCase()}
                    onChange={(e) => setTheme({ seed: e.target.value.toUpperCase() })}
                    className="absolute inset-0 cursor-pointer opacity-0"
                    aria-label={t('org.look.anyColour')}
                  />
                </label>
              </div>
              {clash && (
                <p className="mt-3 flex items-start gap-2 text-xs text-status-warn-fg">
                  <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                  {t('dev.clash')}
                </p>
              )}
            </div>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="flex justify-between font-medium">
                  {t('dev.warmth')} <span className="tabular text-muted-foreground">{theme.warmth}</span>
                </span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={theme.warmth}
                  onChange={(e) => setTheme({ warmth: Number(e.target.value) })}
                  className="mt-2 w-full accent-[var(--accent)]"
                />
              </label>
              <label className="block text-sm">
                <span className="flex justify-between font-medium">
                  {t('dev.corners')} <span className="tabular text-muted-foreground">{theme.radius}px</span>
                </span>
                <input
                  type="range"
                  min={4}
                  max={22}
                  value={theme.radius}
                  onChange={(e) => setTheme({ radius: Number(e.target.value) })}
                  className="mt-2 w-full accent-[var(--accent)]"
                />
              </label>
              <label className="flex items-center justify-between gap-3 text-sm">
                {t('dev.darkSidebar')}
                <Switch
                  checked={theme.sidebar === 'dark'}
                  onCheckedChange={(on) => setTheme({ sidebar: on ? 'dark' : 'light' })}
                />
              </label>
              <label className="flex items-center justify-between gap-3 text-sm">
                {t('dev.accentButtons')}
                <Switch
                  checked={theme.buttons === 'accent'}
                  onCheckedChange={(on) => setTheme({ buttons: on ? 'accent' : 'ink' })}
                />
              </label>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t('org.look.brand')}</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={t('org.look.appName')}>
              <Input
                value={form.appName}
                maxLength={40}
                onChange={(e) => setForm({ ...form, appName: e.target.value })}
              />
            </Field>
            <Field label={t('org.look.logo')} hint={t('org.look.logoHint')}>
              <div className="flex items-center gap-3">
                <BrandMark
                  appName={form.appName}
                  logoUrl={form.logoFileId ? `/api/files/${form.logoFileId}` : null}
                  className="size-11"
                />
                <input
                  ref={file}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => void onFile(e.target.files?.[0])}
                />
                <Button onClick={() => file.current?.click()} disabled={uploading}>
                  {uploading ? <Loader2 className="animate-spin" /> : <ImageUp />} {t('org.look.upload')}
                </Button>
                {form.logoFileId && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setForm({ ...form, logoFileId: null })}
                    aria-label={t('org.remove')}
                  >
                    <X />
                  </Button>
                )}
              </div>
            </Field>
            <Field label={t('org.look.defaultLang')}>
              <Select
                value={form.defaultLang}
                onChange={(e) => setForm({ ...form, defaultLang: e.target.value as 'en' | 'hi' })}
              >
                <option value="en">English</option>
                <option value="hi">हिंदी</option>
              </Select>
            </Field>
            <Field label={t('org.look.defaultMode')}>
              <Select
                value={form.defaultThemeMode}
                onChange={(e) =>
                  setForm({
                    ...form,
                    defaultThemeMode: e.target.value as AppearanceInput['defaultThemeMode'],
                  })
                }
              >
                <option value="system">{t('shell.system')}</option>
                <option value="light">{t('shell.light')}</option>
                <option value="dark">{t('shell.dark')}</option>
              </Select>
            </Field>
            <label className="flex items-center justify-between gap-3 text-sm sm:col-span-2">
              <span>
                {t('org.look.staffAccent')}
                <span className="block text-xs text-muted-foreground">{t('org.look.staffAccentHint')}</span>
              </span>
              <Switch
                checked={form.staffMayPickAccent}
                onCheckedChange={(on) => setForm({ ...form, staffMayPickAccent: on })}
              />
            </label>
          </CardContent>
        </Card>
      </div>
      <div className="space-y-3 xl:sticky xl:top-20 xl:self-start">
        <Card className="space-y-3 p-4">
          <div className="text-sm font-semibold">{t('org.look.preview')}</div>
          <div className="grid grid-cols-2 gap-2">
            <KpiTile hero label={t('org.look.pending')} value={18} />
            <KpiTile label={t('org.look.overdue')} value={4} tone="bad" />
          </div>
          <div className="flex flex-wrap gap-2">
            <StatusChip tone="ok">{t('status.ok')}</StatusChip>
            <StatusChip tone="warn">{t('status.warn')}</StatusChip>
            <StatusChip tone="bad">{t('status.bad')}</StatusChip>
          </div>
          <div className="flex gap-2">
            <Button variant="primary">{t('org.look.sampleButton')}</Button>
            <Button>{t('org.look.sampleSecondary')}</Button>
          </div>
        </Card>
        <div className="flex gap-2">
          <Button className="flex-1" disabled={!dirty} onClick={() => setForm(saved)}>
            {t('org.look.discard')}
          </Button>
          <Button
            variant="primary"
            className="flex-1"
            disabled={!dirty || save.isPending || !form.appName.trim()}
            onClick={() => save.mutate(form)}
          >
            {save.isPending && <Loader2 className="animate-spin" />} {t('common.save')}
          </Button>
        </div>
      </div>
    </div>
  );
}
