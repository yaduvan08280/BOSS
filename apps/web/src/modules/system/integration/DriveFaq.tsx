import { useTranslation } from 'react-i18next';

const QUESTIONS = ['see', 'existing', 'pause', 'publish', 'cost', 'backup'] as const;

/** The FAQ panel next to the Drive steps. */
export function DriveFaq({ app }: { app: string }) {
  const { t } = useTranslation();
  return (
    <aside className="space-y-2 self-start rounded-card border bg-card p-4">
      <h2 className="font-semibold">{t('drive.faq.title')}</h2>
      {QUESTIONS.map((k) => (
        <details key={k} className="group border-t pt-2 first-of-type:border-t-0">
          <summary className="cursor-pointer list-none py-1 text-sm font-medium marker:hidden">
            {t(`drive.faq.${k}.q`, { app })}
          </summary>
          <p className="pb-1 text-sm text-muted-foreground">{t(`drive.faq.${k}.a`, { app })}</p>
        </details>
      ))}
    </aside>
  );
}
