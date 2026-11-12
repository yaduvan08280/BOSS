import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BRANCH_TYPES, INDIAN_STATES, type BranchDetails, type OrgPerson } from '@mono/shared';
import { PeoplePicker } from '@/components/people-picker';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Select } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { patch, post, put, useOrgMutation } from '../api';
import { filled, regionTree, type GroupBranch, type Manager, type Structure } from './api';
import { Licences } from './Licences';
import { EntityField } from './StructureDialogs';

type Shared = { structure: Structure; people: OrgPerson[]; onClose: () => void };
const holders = (managers: Manager[], role: Manager['role'], at: { branchId?: string; regionId?: string }) =>
  managers
    .filter((m) => m.role === role && (at.branchId ? m.branchId === at.branchId : m.regionId === at.regionId))
    .map((m) => m.userId);

/** A branch: what it is, where it sits, and who runs it (managers and its HR person). */
export function BranchDialog({
  branch,
  structure,
  people,
  onClose,
}: Shared & { branch: Partial<GroupBranch> }) {
  const { t } = useTranslation();
  const [d, setD] = useState({
    name: branch.name ?? '',
    code: branch.code ?? '',
    type: branch.type ?? 'OUTLET',
    entityId: branch.entityId ?? '',
    regionId: branch.regionId ?? '',
    city: branch.city ?? '',
    state: branch.state ?? '',
    timezone: branch.timezone ?? '',
  });
  const [x, setX] = useState<BranchDetails>(branch.details ?? {});
  const at = { branchId: branch.id ?? '-' };
  const [managers, setManagers] = useState(() => holders(structure.managers, 'MANAGER', at));
  const [hr, setHr] = useState(() => holders(structure.managers, 'HR', at));
  const save = useOrgMutation(
    async () => {
      const body = {
        name: d.name,
        code: d.code || null,
        type: d.type,
        entityId: d.entityId || null,
        regionId: d.regionId || null,
        city: d.city || null,
        state: d.state || null,
        timezone: d.timezone || null,
        details: {
          address: x.address || null,
          seriesCode: x.seriesCode || null,
          licences: filled(x.licences ?? []),
        },
      };
      const saved = branch.id
        ? await patch<{ id: string }>(`/api/org/branches/${branch.id}`, body)
        : await post<{ id: string }>('/api/org/branches', body);
      const branchId = branch.id ?? saved.id;
      await put('/api/branches/managers', { branchId, role: 'MANAGER', userIds: managers });
      await put('/api/branches/managers', { branchId, role: 'HR', userIds: hr });
    },
    { success: t('org.saved') },
  );
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={branch.id ? t('org.branches.edit') : t('org.branches.add')}
      footer={
        <Button
          variant="primary"
          disabled={!d.name.trim() || save.isPending}
          onClick={() => save.mutate(undefined, { onSuccess: onClose })}
        >
          {t('common.save')}
        </Button>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('org.name')} className="col-span-2 sm:col-span-1">
          <Input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} autoFocus />
        </Field>
        <Field label={t('org.branches.code')} className="col-span-2 sm:col-span-1">
          <Input
            value={d.code}
            className="font-mono"
            onChange={(e) => setD({ ...d, code: e.target.value.toUpperCase() })}
          />
        </Field>
        <Field label={t('branches.type.label')} className="col-span-2 sm:col-span-1">
          <Select
            value={d.type}
            onChange={(e) => setD({ ...d, type: e.target.value as GroupBranch['type'] })}
          >
            {BRANCH_TYPES.map((x) => (
              <option key={x} value={x}>
                {t(`branches.type.${x}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('branches.region.one')} className="col-span-2 sm:col-span-1">
          <Select value={d.regionId} onChange={(e) => setD({ ...d, regionId: e.target.value })}>
            <option value="">{t('branches.region.none')}</option>
            {regionTree(structure.regions).map(({ region: r, depth }) => (
              <option key={r.id} value={r.id}>
                {`${'— '.repeat(depth)}${r.name}`}
              </option>
            ))}
          </Select>
        </Field>
        <div className="col-span-2">
          <EntityField
            value={d.entityId}
            entities={structure.entities}
            onChange={(entityId) => setD({ ...d, entityId })}
          />
        </div>
        <Field label={t('org.company.city')}>
          <Input value={d.city} onChange={(e) => setD({ ...d, city: e.target.value })} />
        </Field>
        <Field label={t('org.company.state')}>
          <Select value={d.state} onChange={(e) => setD({ ...d, state: e.target.value })}>
            <option value="">{t('org.choose')}</option>
            {[...new Set([...INDIAN_STATES, ...(d.state ? [d.state] : [])])].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </Select>
        </Field>
        <Field label={t('branches.timezone')} hint={t('branches.timezoneHint')} className="col-span-2">
          <Input
            value={d.timezone}
            placeholder="Asia/Kolkata"
            onChange={(e) => setD({ ...d, timezone: e.target.value.trim() })}
          />
        </Field>
        <Field label={t('branches.address')} className="col-span-2">
          <Input value={x.address ?? ''} onChange={(e) => setX({ ...x, address: e.target.value })} />
        </Field>
        <Field
          label={t('branches.seriesCode')}
          hint={t('branches.seriesCodeHint')}
          className="col-span-2 sm:col-span-1"
        >
          <Input
            value={x.seriesCode ?? ''}
            maxLength={6}
            className="font-mono"
            onChange={(e) => setX({ ...x, seriesCode: e.target.value.toUpperCase() })}
          />
        </Field>
        <div className="col-span-2">
          <Licences value={x.licences ?? []} onChange={(licences) => setX({ ...x, licences })} />
        </div>
        <Field label={t('branches.managers')} hint={t('branches.managersHint')} className="col-span-2">
          <PeoplePicker
            ids={managers}
            people={people}
            onChange={setManagers}
            label={t('branches.managers')}
          />
        </Field>
        <Field label={t('branches.hrPeople')} className="col-span-2">
          <PeoplePicker ids={hr} people={people} onChange={setHr} label={t('branches.hrPeople')} />
        </Field>
      </div>
    </Dialog>
  );
}
