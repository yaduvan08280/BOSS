import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { EngineModule, OrgPerson } from '@mono/shared';
import { Button } from '@/components/ui/button';
import { Field, Select } from '@/components/ui/form';
import { api } from '@/lib/api';
import { personLabel } from '@/lib/people';
import { errorMessage, useBranches } from '../api';
import { ENGINE_FIELDS } from './fields';

type Row = { branchId: string; people: Record<string, string> };

/**
 * The same people as "who does it", for one branch (phase 12): a branch's own slip receiver, ticket coordinator
 * or verifier stands in for the company's. Times, rules and switches are never per branch.
 */
export function BranchPeople({ module, people }: { module: EngineModule; people: OrgPerson[] }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const branches = useBranches().data ?? [];
  const key = ['engine', 'branch-people', module];
  const rows = useQuery({
    queryKey: key,
    queryFn: () => api<Row[]>(`/api/work/settings/${module}/branches`),
    enabled: branches.length > 1,
  });
  const [branchId, setBranchId] = useState('');
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const fields = ENGINE_FIELDS[module].who.filter((f) => f.kind === 'person');
  if (branches.length < 2 || !fields.length) return null;
  const active = people.filter((p) => p.status === 'ACTIVE');
  const pick = (id: string) => {
    setBranchId(id);
    setDraft(rows.data?.find((r) => r.branchId === id)?.people ?? {});
  };
  const save = async () => {
    setBusy(true);
    try {
      const body = Object.fromEntries(fields.map((f) => [f.key, draft[f.key] || null]));
      await api(`/api/work/settings/${module}/branches/${branchId}`, { method: 'PUT', body });
      await qc.invalidateQueries({ queryKey: key });
      toast.success(t('engine.saved'));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const withOwn = new Set(rows.data?.map((r) => r.branchId));
  return (
    <section className="space-y-3 rounded-control border p-3">
      <div>
        <h3 className="text-sm font-semibold">{t('engineBranch.title')}</h3>
        <p className="text-xs text-muted-foreground">{t('engineBranch.hint')}</p>
      </div>
      <Select aria-label={t('engineBranch.branch')} value={branchId} onChange={(e) => pick(e.target.value)}>
        <option value="">{t('engineBranch.choose')}</option>
        {branches.map((b) => (
          <option key={b.id} value={b.id}>
            {withOwn.has(b.id) ? t('engineBranch.hasOwn', { name: b.name }) : b.name}
          </option>
        ))}
      </Select>
      {branchId && (
        <>
          {fields.map((f) => (
            <Field key={f.key} label={t(`engine.f.${f.key}`)}>
              <Select
                value={draft[f.key] ?? ''}
                onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
              >
                <option value="">{t('engineBranch.same')}</option>
                {active.map((p) => (
                  <option key={p.id} value={p.id}>
                    {personLabel(p)}
                  </option>
                ))}
              </Select>
            </Field>
          ))}
          <Button size="sm" variant="primary" disabled={busy} onClick={() => void save()}>
            {t('common.save')}
          </Button>
        </>
      )}
    </section>
  );
}
