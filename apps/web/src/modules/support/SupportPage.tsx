import { useQuery } from '@tanstack/react-query';
import { BookOpen, LifeBuoy, Mail, Phone, Printer } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { ErrorState, PageHeader, PageSkeleton } from '@/components/page';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { GUIDES, loadGuide } from './guides';
import { Markdown } from './Markdown';

type Person = {
  id: string;
  name: string;
  phone?: string | null;
  mobile?: string | null;
  email: string | null;
  role: string;
};

/** Support (top bar ? and Workspace → Support): whom to call, a help ticket, and the user guides. */
export function SupportPage() {
  const { t } = useTranslation();
  const q = useQuery({
    queryKey: ['support'],
    queryFn: () => api<{ contacts: Person[]; admins: Person[] }>('/api/org/support'),
  });
  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  const people = [
    ...q.data.contacts,
    ...q.data.admins.filter((a) => !q.data.contacts.some((c) => c.name === a.name)),
  ];
  return (
    <div className="space-y-6">
      <PageHeader title={t('nav.support')} subtitle={t('support.subtitle')} />
      <div className="grid gap-4 md:grid-cols-2">
        <section className="space-y-3 rounded-card border bg-card p-4">
          <h2 className="font-semibold">{t('support.ask')}</h2>
          <ul className="divide-y">
            {people.map((p) => {
              const phone = p.phone ?? p.mobile;
              return (
                <li key={p.id} className="flex flex-wrap items-center gap-2 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{p.name}</div>
                    <div className="text-xs text-muted-foreground">{p.role}</div>
                  </div>
                  {phone && (
                    <Button asChild size="sm" variant="ghost">
                      <a href={`tel:${phone}`}>
                        <Phone /> {phone}
                      </a>
                    </Button>
                  )}
                  {p.email && (
                    <Button asChild size="icon-sm" variant="ghost" aria-label={p.email}>
                      <a href={`mailto:${p.email}`}>
                        <Mail />
                      </a>
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
        <section className="space-y-3 rounded-card border bg-card p-4">
          <h2 className="font-semibold">{t('support.ticket')}</h2>
          <p className="text-sm text-muted-foreground">{t('support.ticketBody')}</p>
          <Button asChild>
            <Link to="/help-tickets?tab=raise">
              <LifeBuoy /> {t('support.raise')}
            </Link>
          </Button>
        </section>
      </div>
      <section className="space-y-3">
        <h2 className="font-semibold">{t('support.guides')}</h2>
        <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {GUIDES.map((g) => (
            <li key={g}>
              <Link
                to={`/support/guide/${g}`}
                className="flex items-center gap-3 rounded-card border bg-card p-3 hover:bg-muted/50"
              >
                <BookOpen className="size-5 shrink-0 text-muted-foreground" />
                <span className="text-sm font-medium">
                  {t(`support.guide.${g.slice(3).replace(/-/g, '_')}`)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/** One guide, readable on a phone and printable (Print hides the menus). */
export function GuidePage() {
  const { t } = useTranslation();
  const { slug = '' } = useParams();
  const [text, setText] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void loadGuide(slug).then((s) => live && setText(s));
    return () => {
      live = false;
    };
  }, [slug]);
  if (text === undefined) return <PageSkeleton />;
  if (text === null) return <ErrorState />;
  return (
    <article className="mx-auto max-w-3xl space-y-4">
      <div className="flex gap-2 print:hidden">
        <Button asChild variant="ghost" size="sm">
          <Link to="/support">{t('support.allGuides')}</Link>
        </Button>
        <Button variant="secondary" size="sm" className="ml-auto" onClick={() => window.print()}>
          <Printer /> {t('support.print')}
        </Button>
      </div>
      <div className="rounded-card border bg-card p-4 sm:p-6 print:border-0 print:p-0">
        <Markdown source={text} />
      </div>
    </article>
  );
}
