import { Loader2, Save, TriangleAlert } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  SEED_POOL,
  seedClashesWithStatus,
  type AppearanceInput,
  type Me,
  type ThemeSettings,
} from '@mono/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { applyTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { put, useOrgMutation } from '@/modules/system/api';

/**
 * Live preview of the theme generator, saved as the company theme with one button (the page is
 * System Master only). Logo, app name and defaults stay in System Master → Appearance and are kept as they are.
 */
export function ThemePlayground({ me }: { me: Me }) {
  const { t } = useTranslation();
  const [theme, setTheme] = useState<ThemeSettings>(me.company.theme);
  const save = useOrgMutation(
    async (next: ThemeSettings) => {
      // Send the whole saved appearance back with only the theme changed, so nothing else is lost.
      const current = await api<AppearanceInput>('/api/org/appearance');
      return put('/api/org/appearance', { ...current, theme: next });
    },
    { success: t('org.saved') },
  );
  const dirty = JSON.stringify(theme) !== JSON.stringify(me.company.theme);

  useEffect(() => applyTheme(theme, me.user.themeMode), [theme, me.user.themeMode]);
  // On leaving, put back the company theme as it is then (it may have just been saved here).
  const latest = useRef(me);
  useEffect(() => {
    latest.current = me;
  }, [me]);
  useEffect(() => () => applyTheme(latest.current.company.theme, latest.current.user.themeMode), []);
  const set = (patch: Partial<ThemeSettings>) => setTheme((th) => ({ ...th, ...patch }));
  const clash = seedClashesWithStatus(theme.seed);

  return (
    <Card>
      <CardHeader className="flex-wrap">
        <div className="min-w-0">
          <CardTitle>{t('dev.playground')}</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">{t('dev.playgroundHint')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={!dirty || save.isPending} onClick={() => setTheme(me.company.theme)}>
            {t('dev.reset')}
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={!dirty || save.isPending}
            onClick={() => save.mutate(theme)}
          >
            {save.isPending ? <Loader2 className="animate-spin" /> : <Save />} {t('dev.save')}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div>
          <div className="mb-2 text-sm font-medium">{t('dev.seed')}</div>
          <div className="flex flex-wrap gap-2">
            {SEED_POOL.map((c) => (
              <button
                key={c}
                onClick={() => set({ seed: c })}
                style={{ background: c }}
                aria-label={c}
                className={cn(
                  'size-8 rounded-full border border-black/10 transition-transform hover:scale-110',
                  theme.seed.toUpperCase() === c && 'ring-2 ring-foreground ring-offset-2 ring-offset-card',
                )}
              />
            ))}
            <label className="relative grid size-8 cursor-pointer place-items-center overflow-hidden rounded-full border bg-[conic-gradient(red,yellow,lime,cyan,blue,magenta,red)]">
              <input
                type="color"
                value={theme.seed.toLowerCase()}
                onChange={(e) => set({ seed: e.target.value.toUpperCase() })}
                className="absolute inset-0 cursor-pointer opacity-0"
                aria-label="Any colour"
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
              onChange={(e) => set({ warmth: Number(e.target.value) })}
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
              onChange={(e) => set({ radius: Number(e.target.value) })}
              className="mt-2 w-full accent-[var(--accent)]"
            />
          </label>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-3 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="size-4 accent-[var(--accent)]"
              checked={theme.sidebar === 'dark'}
              onChange={(e) => set({ sidebar: e.target.checked ? 'dark' : 'light' })}
            />
            {t('dev.darkSidebar')}
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="size-4 accent-[var(--accent)]"
              checked={theme.buttons === 'accent'}
              onChange={(e) => set({ buttons: e.target.checked ? 'accent' : 'ink' })}
            />
            {t('dev.accentButtons')}
          </label>
        </div>
      </CardContent>
    </Card>
  );
}
