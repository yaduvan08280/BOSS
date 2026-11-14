import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { APPROVAL_KINDS, type ApprovalStep, type OrgPerson } from '@mono/shared';
import { ErrorState, PageSkeleton } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/form';
import { del, useOrgMutation, useUsers } from '../api';
import { useRoutes, useStructure, type Route } from './api';
import { RouteDialog } from './RouteDialog';

/** "Branch manager → Area manager (from ₹10,000) → Owner". */
function useStepText(people: OrgPerson[]) {
  const { t } = useTranslation();
  const name = new Map(people.map((p) => [p.id, p.name]));
  return (s: ApprovalStep) => {
    const who = s.who === 'user' ? (name.get(s.userId ?? '') ?? '?') : t(`branches.who.${s.who}`);
    const notes = [
      s.fromAmount ? t('branches.route.fromNote', { amount: s.fromAmount.toLocaleString('en-IN') }) : '',
      s.escalateAfterHours ? t('branches.route.upNote', { count: s.escalateAfterHours }) : '',
    ].filter(Boolean);
    return notes.length ? `${who} (${notes.join(', ')})` : who;
  };
}

/** Who approves what: one ladder per kind of request, for the group or for one entity or branch. */
export function ApprovalsPanel() {
  const { t } = useTranslation();
  const routes = useRoutes();
  const structure = useStructure();
  const users = useUsers();
  const [edit, setEdit] = useState<Partial<Route> | null>(null);
  const remove = useOrgMutation((id: string) => del(`/api/branches/approvals/${id}`), {
    success: t('org.deleted'),
  });
  const stepText = useStepText(users.data ?? []);

  if (routes.isPending || structure.isPending || users.isPending) return <PageSkeleton />;
  if (routes.isError || structure.isError || users.isError)
    return <ErrorState onRetry={() => void routes.refetch()} error={routes.error} />;
  const s = structure.data;
  const placeOf = (r: Route) =>
    r.branchId
      ? (s.branches.find((b) => b.id === r.branchId)?.name ?? '?')
      : r.entityId
        ? (s.entities.find((e) => e.id === r.entityId)?.name ?? '?')
        : t('branches.route.wholeGroup');

  return (
    <div className="max-w-3xl space-y-4">
      <p className="text-sm text-muted-foreground">{t('branches.route.intro')}</p>
      {APPROVAL_KINDS.map((kind) => {
        const mine = routes.data
          .filter((r) => r.kind === kind)
          .sort(
            (a, b) => Number(Boolean(a.branchId || a.entityId)) - Number(Boolean(b.branchId || b.entityId)),
          );
        return (
          <section key={kind} aria-label={t(`branches.kind.${kind}`)}>
            <Card className="space-y-3 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="font-semibold">{t(`branches.kind.${kind}`)}</h2>
                  {mine.length === 0 && (
                    <p className="text-xs text-muted-foreground">{t(`branches.unset.${kind}`)}</p>
                  )}
                </div>
                <Button variant="secondary" size="sm" onClick={() => setEdit({ kind })}>
                  <Plus /> {mine.length ? t('branches.route.addOverride') : t('branches.route.set')}
                </Button>
              </div>
              {mine.map((r) => (
                <div key={r.id} className="flex items-start gap-2 rounded-control border p-3">
                  <div className="min-w-0 flex-1 space-y-1">
                    <Badge>{placeOf(r)}</Badge>
                    <ol className="text-sm">
                      {r.steps.map((step, i) => (
                        <li key={i}>
                          <span className="tabular mr-1.5 text-muted-foreground">{i + 1}.</span>
                          {stepText(step)}
                        </li>
                      ))}
                    </ol>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('org.edit')}
                    onClick={() => setEdit(r)}
                  >
                    <Pencil />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('org.delete')}
                    onClick={() => remove.mutate(r.id)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              ))}
            </Card>
          </section>
        );
      })}
      {edit && <RouteDialog route={edit} structure={s} people={users.data} onClose={() => setEdit(null)} />}
    </div>
  );
}
