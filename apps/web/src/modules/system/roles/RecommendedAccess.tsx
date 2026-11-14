import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Wand2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { post, useOrgMutation } from '../api';

type Plan = {
  roles: {
    id: string | null;
    name: string;
    isNew: boolean;
    people: number;
    reachFrom: string | null;
    reachTo: string;
    loses: string[];
    gains: string[];
  }[];
  moves: { userId: string; name: string; department: string; from: string; to: string }[];
};

/** One button for MONO's recommended access: what would change is shown first; nothing is saved until "Apply". */
export function RecommendedAccess() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ['org', 'roles', 'recommended'],
    queryFn: () => api<Plan>('/api/org/roles/recommended'),
    enabled: open,
  });
  const apply = useOrgMutation(() => post('/api/org/roles/recommended', {}), {
    success: t('access.applied'),
  });
  const mod = (m: string) => t([`org.modules.${m}`, `${m}.title`], m);
  const plan = q.data;
  const nothing = plan && !plan.roles.length && !plan.moves.length;
  return (
    <Card className="p-4">
      <div className="text-sm font-semibold">{t('access.title')}</div>
      <p className="mt-1 text-xs text-muted-foreground">{t('access.body')}</p>
      <Button className="mt-3" variant="secondary" onClick={() => setOpen(true)}>
        <Wand2 /> {t('access.open')}
      </Button>
      {open && (
        <Dialog
          open
          wide
          onOpenChange={(o) => !o && setOpen(false)}
          title={t('access.title')}
          footer={
            <>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button
                variant="primary"
                disabled={!plan || nothing || apply.isPending}
                onClick={() =>
                  apply.mutate(undefined, {
                    onSuccess: () => {
                      void qc.invalidateQueries({ queryKey: ['org', 'roles', 'recommended'] });
                      setOpen(false);
                    },
                  })
                }
              >
                {apply.isPending && <Loader2 className="animate-spin" />} {t('access.apply')}
              </Button>
            </>
          }
        >
          {q.isPending ? (
            <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
          ) : q.isError || !plan ? (
            <p className="text-sm text-status-bad-fg">{t('access.failed')}</p>
          ) : nothing ? (
            <p className="text-sm">{t('access.nothing')}</p>
          ) : (
            <div className="space-y-5 text-sm">
              <p className="text-muted-foreground">{t('access.intro')}</p>
              {plan.roles.length > 0 && (
                <section>
                  <h3 className="mb-2 font-semibold">{t('access.roles')}</h3>
                  <ul className="divide-y rounded-control border">
                    {plan.roles.map((r) => (
                      <li key={r.name} className="space-y-0.5 px-3 py-2.5">
                        <div className="font-medium">
                          {r.name}{' '}
                          <span className="text-xs font-normal text-muted-foreground">
                            {r.isNew ? t('access.newRole') : t('access.people', { count: r.people })}
                          </span>
                        </div>
                        {r.reachFrom !== r.reachTo && (
                          <div className="text-xs">
                            {t('access.sees')}: <strong>{t(`rolereach.${r.reachTo}`)}</strong>
                            {r.reachFrom && (
                              <span className="text-muted-foreground">
                                {' '}
                                ({t('access.was', { was: t(`rolereach.${r.reachFrom}`) })})
                              </span>
                            )}
                          </div>
                        )}
                        {r.loses.length > 0 && (
                          <div className="text-xs break-words text-status-bad-fg">
                            {t('access.loses')}: {r.loses.map(mod).join(', ')}
                          </div>
                        )}
                        {r.gains.length > 0 && (
                          <div className="text-xs break-words text-status-ok-fg">
                            {t('access.gains')}: {r.gains.map(mod).join(', ')}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {plan.moves.length > 0 && (
                <section>
                  <h3 className="mb-1 font-semibold">{t('access.moves', { count: plan.moves.length })}</h3>
                  <p className="mb-2 text-xs text-muted-foreground">{t('access.movesHint')}</p>
                  <ul className="divide-y rounded-control border">
                    {plan.moves.map((m) => (
                      <li key={m.userId} className="flex flex-wrap justify-between gap-x-3 px-3 py-2">
                        <span className="min-w-0 break-words">
                          {m.name} <span className="text-xs text-muted-foreground">· {m.department}</span>
                        </span>
                        <span className="text-xs font-medium">→ {m.to}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          )}
        </Dialog>
      )}
    </Card>
  );
}
