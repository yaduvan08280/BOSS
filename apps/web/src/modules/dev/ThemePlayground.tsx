import { TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SEED_POOL, seedClashesWithStatus, type Me, type ThemeSettings } from '@mono/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { applyTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';

/** Live preview of the theme generator. Saving the company theme arrives with Appearance (phase 1). */
export function ThemePlayground({ me }: { me: Me }) {
  const { t } = useTranslation();
  const [theme, setTheme] = useState<ThemeSettings>(me.company.theme);
  useEffect(() => applyTheme(theme, me.user.themeMode), [theme, me.user.themeMode]);
  useEffect(() => () => applyTheme(me.company.theme, me.user.themeMode), [me]);
  const set = (patch: Partial<ThemeSettings>) => setTheme((th) => ({ ...th, ...patch }));
  const clash = seedClashesWithStatus(theme.seed);

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>{t('dev.playground')}</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">{t('dev.playgroundHint')}</p>
        </div>
        <Button size="sm" onClick={() => setTheme(me.company.theme)}>
          {t('dev.reset')}
        </Button>
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
