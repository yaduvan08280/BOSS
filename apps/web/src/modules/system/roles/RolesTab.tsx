import { Loader2, Lock, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorState, PageSkeleton } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge, Checkbox } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { del, patch, post, useOrgMutation, useRoles, type Role } from '../api';

const PROCESS_ROLES = ['coordinator', 'problemSolver', 'verifier'];

export function RolesTab() {
  const { t } = useTranslation();
  const q = useRoles();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string[]>>({});
  const [newName, setNewName] = useState('');
  const save = useOrgMutation(
    ({ id, permissions }: { id: string; permissions: string[] }) =>
      patch(`/api/org/roles/${id}`, { permissions }),
    { success: t('org.saved') },
  );
  const create = useOrgMutation((name: string) =>
    post<Role>('/api/org/roles', { name, permissions: ['org.view'] }),
  );
  const remove = useOrgMutation((id: string) => del(`/api/org/roles/${id}`), { success: t('org.deleted') });

  const roles = q.data?.roles ?? [];
  const role = roles.find((r) => r.id === selectedId) ?? roles[0];

  if (q.isPending) return <PageSkeleton />;
  if (q.isError || !role) return <ErrorState onRetry={() => void q.refetch()} />;
  const { modules, actions } = q.data;
  const isOwner = role.key === 'OWNER';
  const perms = new Set(drafts[role.id] ?? role.permissions);
  const has = (key: string) => isOwner || perms.has(key);
  const toggle = (key: string) => {
    const next = new Set(perms);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setDrafts((d) => ({ ...d, [role.id]: [...next] }));
  };
  const dirty = !isOwner && [...perms].sort().join() !== [...role.permissions].sort().join();

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_1fr]">
      <div className="space-y-3">
        <Card className="p-2">
          {roles.map((r) => (
            <button
              key={r.id}
              onClick={() => setSelectedId(r.id)}
              className={cn(
                'flex w-full items-center gap-3 rounded-control px-3 py-2.5 text-left text-sm',
                r.id === role.id ? 'bg-muted font-semibold' : 'hover:bg-muted/60',
              )}
            >
              <ShieldCheck className="size-4 text-muted-foreground" />
              <span className="flex-1">{r.name}</span>
              {r.builtIn && (
                <Lock className="size-3 text-muted-foreground" aria-label={t('org.roles.builtIn')} />
              )}
              <Badge>{r.people}</Badge>
            </button>
          ))}
          <form
            className="mt-1 flex gap-1.5 border-t p-1 pt-2"
            onSubmit={(e) => (
              e.preventDefault(),
              newName.trim() &&
                create.mutate(newName.trim(), { onSuccess: (r) => (setNewName(''), setSelectedId(r.id)) })
            )}
          >
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t('org.roles.newPh')}
              className="h-9 sm:h-9"
            />
            <Button
              type="submit"
              size="icon"
              className="size-9"
              disabled={!newName.trim()}
              aria-label={t('org.roles.add')}
            >
              <Plus />
            </Button>
          </form>
        </Card>
        <Card className="p-4">
          <div className="text-sm font-semibold">{t('org.roles.processTitle')}</div>
          <p className="mt-1 text-xs text-muted-foreground">{t('org.roles.processBody')}</p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {PROCESS_ROLES.map((k) => (
              <span key={k} className="rounded-pill bg-muted px-2.5 py-1 text-xs font-medium">
                {t(`org.roles.process.${k}`)}
              </span>
            ))}
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>{role.name}</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              {isOwner ? t('org.roles.ownerAll') : t('org.roles.matrixHint')}
            </p>
          </div>
          <div className="flex gap-2">
            {!role.builtIn && (
              <Button
                variant="ghost"
                size="sm"
                disabled={role.people > 0}
                title={role.people ? t('org.roles.inUse') : undefined}
                onClick={() => remove.mutate(role.id, { onSuccess: () => setSelectedId(null) })}
              >
                <Trash2 /> {t('org.delete')}
              </Button>
            )}
            {!isOwner && (
              <Button
                variant="primary"
                size="sm"
                disabled={!dirty || save.isPending}
                onClick={() =>
                  save.mutate(
                    { id: role.id, permissions: [...perms] },
                    { onSuccess: () => setDrafts(({ [role.id]: _saved, ...rest }) => rest) },
                  )
                }
              >
                {save.isPending && <Loader2 className="animate-spin" />} {t('common.save')}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="text-xs text-muted-foreground">
                <th className="py-2 text-left font-medium">{t('org.roles.module')}</th>
                {actions.map((a) => (
                  <th key={a} className="w-20 py-2 font-medium">
                    {t(`org.roles.action.${a}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {modules.map((m) => (
                <tr key={m}>
                  <td className="py-2.5 font-medium">{t(`org.modules.${m}`)}</td>
                  {actions.map((a) => (
                    <td key={a} className="text-center">
                      <Checkbox
                        checked={has(`${m}.${a}`)}
                        disabled={isOwner}
                        onChange={() => toggle(`${m}.${a}`)}
                        aria-label={`${m} ${a}`}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
