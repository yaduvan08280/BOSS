import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Select } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { post, useOrgMutation } from '../api';
import type { GroupBranch } from './api';

type Copied = { copied: { locations: number; routes: number; checklists: number } };
type Holds = Record<
  'people' | 'tasks' | 'checklistRuns' | 'slips' | 'tickets' | 'records' | 'purchaseOrders',
  number
>;

/** Open a new outlet as a copy of this one: its set-up comes along, its people don't. */
export function CopyBranchDialog({ branch, onClose }: { branch: GroupBranch; onClose: () => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const copy = useOrgMutation(
    () => post<Copied>(`/api/branches/${branch.id}/copy`, { name, code: code || null }),
    { success: (r) => t('branches.copy.done', r.copied) },
  );
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('branches.copy.title', { name: branch.name })}
      description={t('branches.copy.what')}
      footer={
        <Button
          variant="primary"
          disabled={!name.trim() || copy.isPending}
          onClick={() => copy.mutate(undefined, { onSuccess: onClose })}
        >
          {t('branches.copy.go')}
        </Button>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('branches.copy.name')} className="col-span-2 sm:col-span-1">
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <Field label={t('org.branches.code')} className="col-span-2 sm:col-span-1">
          <Input value={code} className="font-mono" onChange={(e) => setCode(e.target.value.toUpperCase())} />
        </Field>
        <p className="col-span-2 text-xs text-muted-foreground">{t('branches.copy.after')}</p>
      </div>
    </Dialog>
  );
}

/** Close an outlet for good: its people and open work go to another branch first; history stays. */
export function CloseBranchDialog({
  branch,
  others,
  onClose,
}: {
  branch: GroupBranch;
  others: GroupBranch[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [moveTo, setMoveTo] = useState('');
  const preview = useQuery({
    queryKey: ['org', 'close-preview', branch.id],
    queryFn: () => api<{ holds: Holds; clear: boolean }>(`/api/branches/${branch.id}/close`),
  });
  const close = useOrgMutation(
    () => post(`/api/branches/${branch.id}/close`, { moveToBranchId: moveTo || null }),
    { silentError: true },
  );
  const left = Object.entries(preview.data?.holds ?? {}).filter(([, n]) => n > 0);
  const ready = preview.data && (preview.data.clear || moveTo);
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('branches.close.title', { name: branch.name })}
      description={t('branches.close.what')}
      footer={
        <Button
          variant="destructive"
          disabled={!ready || close.isPending}
          onClick={() =>
            close.mutate(undefined, {
              onSuccess: () => {
                toast.success(t('branches.close.done', { name: branch.name }));
                onClose();
              },
              onError: (e) => toast.error(e instanceof Error ? e.message : t('common.somethingWrong')),
            })
          }
        >
          {t('branches.close.go')}
        </Button>
      }
    >
      {preview.isPending ? (
        <div className="h-16 animate-pulse rounded-control bg-muted" />
      ) : preview.isError ? (
        <p className="text-sm text-status-bad-fg">{t('common.somethingWrong')}</p>
      ) : left.length === 0 ? (
        <p className="text-sm">{t('branches.close.clear')}</p>
      ) : (
        <div className="space-y-3">
          <p className="text-sm">{t('branches.close.still')}</p>
          <ul className="list-disc pl-5 text-sm">
            {left.map(([k, n]) => (
              <li key={k}>{t(`branches.close.holds.${k}`, { count: n })}</li>
            ))}
          </ul>
          <Field label={t('branches.close.moveTo')}>
            <Select value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
              <option value="">{t('org.choose')}</option>
              {others.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      )}
    </Dialog>
  );
}
