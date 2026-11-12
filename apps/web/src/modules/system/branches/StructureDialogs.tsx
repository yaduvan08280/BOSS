import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  BRANCH_TYPES,
  INDIAN_STATES,
  type BranchDetails,
  type EntityDetails,
  type OrgPerson,
} from '@mono/shared';
import { PeoplePicker } from '@/components/people-picker';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Select } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { patch, post, put, useOrgMutation } from '../api';
import { Licences } from './Licences';
import {
  filled,
  regionTree,
  type Entity,
  type GroupBranch,
  type Manager,
  type Region,
  type Structure,
} from './api';

type Shared = { structure: Structure; people: OrgPerson[]; onClose: () => void };
const holders = (managers: Manager[], role: Manager['role'], at: { branchId?: string; regionId?: string }) =>
  managers
    .filter((m) => m.role === role && (at.branchId ? m.branchId === at.branchId : m.regionId === at.regionId))
    .map((m) => m.userId);

/** A legal entity: a company of the group or a franchise partner, with its own country, currency and tax number. */
export function EntityDialog({ entity, onClose }: { entity: Partial<Entity>; onClose: () => void }) {
  const { t } = useTranslation();
  const [d, setD] = useState({
    name: entity.name ?? '',
    kind: entity.kind ?? 'OWN',
    country: entity.country ?? 'IN',
    currency: entity.currency ?? 'INR',
    state: entity.state ?? '',
    taxId: entity.taxId ?? '',
  });
  const [x, setX] = useState<EntityDetails>(entity.details ?? {});
  const save = useOrgMutation(
    () => {
      const body = {
        ...d,
        state: d.state || null,
        taxId: d.taxId || null,
        details: {
          legalName: x.legalName || null,
          address: x.address || null,
          seriesCode: x.seriesCode || null,
          letterheadHeader: x.letterheadHeader || null,
          letterheadFooter: x.letterheadFooter || null,
          licences: filled(x.licences ?? []),
        },
      };
      return entity.id
        ? patch(`/api/branches/entities/${entity.id}`, body)
        : post('/api/branches/entities', body);
    },
    { success: t('org.saved') },
  );
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={entity.id ? t('branches.entity.edit') : t('branches.entity.add')}
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
        <Field label={t('org.name')} className="col-span-2">
          <Input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} autoFocus />
        </Field>
        <Field label={t('branches.entity.kind')} className="col-span-2" hint={t('branches.entity.kindHint')}>
          <Select value={d.kind} onChange={(e) => setD({ ...d, kind: e.target.value as Entity['kind'] })}>
            <option value="OWN">{t('branches.entity.OWN')}</option>
            <option value="FRANCHISE">{t('branches.entity.FRANCHISE')}</option>
          </Select>
        </Field>
        <Field label={t('branches.entity.country')} hint={t('branches.entity.countryHint')}>
          <Input
            value={d.country}
            maxLength={2}
            className="font-mono"
            onChange={(e) => setD({ ...d, country: e.target.value.toUpperCase() })}
          />
        </Field>
        <Field label={t('branches.entity.currency')} hint={t('branches.entity.currencyHint')}>
          <Input
            value={d.currency}
            maxLength={3}
            className="font-mono"
            onChange={(e) => setD({ ...d, currency: e.target.value.toUpperCase() })}
          />
        </Field>
        <Field label={t('org.company.state')} className="col-span-2 sm:col-span-1">
          <Input value={d.state} onChange={(e) => setD({ ...d, state: e.target.value })} />
        </Field>
        <Field label={t('branches.entity.taxId')} className="col-span-2 sm:col-span-1">
          <Input
            value={d.taxId}
            className="font-mono"
            onChange={(e) => setD({ ...d, taxId: e.target.value.toUpperCase() })}
          />
        </Field>
        <Field label={t('branches.entity.legalName')} className="col-span-2">
          <Input value={x.legalName ?? ''} onChange={(e) => setX({ ...x, legalName: e.target.value })} />
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
        <Field
          label={t('branches.entity.footer')}
          hint={t('branches.entity.footerHint')}
          className="col-span-2"
        >
          <Input
            value={x.letterheadFooter ?? ''}
            onChange={(e) => setX({ ...x, letterheadFooter: e.target.value })}
          />
        </Field>
        <div className="col-span-2">
          <Licences value={x.licences ?? []} onChange={(licences) => setX({ ...x, licences })} />
        </div>
      </div>
    </Dialog>
  );
}

/** A region (any depth) and its area managers. */
export function RegionDialog({ region, structure, people, onClose }: Shared & { region: Partial<Region> }) {
  const { t } = useTranslation();
  const [d, setD] = useState({
    name: region.name ?? '',
    entityId: region.entityId ?? '',
    parentId: region.parentId ?? '',
  });
  const [area, setArea] = useState(() =>
    region.id ? holders(structure.managers, 'AREA', { regionId: region.id }) : [],
  );
  const save = useOrgMutation(
    async () => {
      const body = { name: d.name, entityId: d.entityId || null, parentId: d.parentId || null };
      const saved = region.id
        ? await patch<{ id: string }>(`/api/branches/regions/${region.id}`, body)
        : await post<{ id: string }>('/api/branches/regions', body);
      await put('/api/branches/managers', { regionId: region.id ?? saved.id, role: 'AREA', userIds: area });
    },
    { success: t('org.saved') },
  );
  // A region can't sit under itself or anything below it.
  const tree = regionTree(structure.regions);
  const below = new Set<string>(region.id ? [region.id] : []);
  for (const { region: r } of tree) if (r.parentId && below.has(r.parentId)) below.add(r.id);
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={region.id ? t('branches.region.edit') : t('branches.region.add')}
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
      <div className="space-y-3">
        <Field label={t('org.name')}>
          <Input
            value={d.name}
            onChange={(e) => setD({ ...d, name: e.target.value })}
            placeholder={t('branches.region.namePh')}
            autoFocus
          />
        </Field>
        <Field label={t('branches.region.parent')}>
          <Select value={d.parentId} onChange={(e) => setD({ ...d, parentId: e.target.value })}>
            <option value="">{t('branches.region.noParent')}</option>
            {tree
              .filter(({ region: r }) => !below.has(r.id))
              .map(({ region: r, depth }) => (
                <option key={r.id} value={r.id}>
                  {`${'— '.repeat(depth)}${r.name}`}
                </option>
              ))}
          </Select>
        </Field>
        <EntityField
          value={d.entityId}
          entities={structure.entities}
          onChange={(entityId) => setD({ ...d, entityId })}
        />
        <Field label={t('branches.areaManagers')} hint={t('branches.areaManagersHint')}>
          <PeoplePicker ids={area} people={people} onChange={setArea} label={t('branches.areaManagers')} />
        </Field>
      </div>
    </Dialog>
  );
}

function EntityField({
  value,
  entities,
  onChange,
}: {
  value: string;
  entities: Entity[];
  onChange: (id: string) => void;
}) {
  const { t } = useTranslation();
  if (!entities.length) return null;
  return (
    <Field label={t('branches.entity.one')}>
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{t('branches.entity.none')}</option>
        {entities.map((e) => (
          <option key={e.id} value={e.id}>
            {e.name}
          </option>
        ))}
      </Select>
    </Field>
  );
}

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
