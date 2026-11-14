import { useTranslation } from 'react-i18next';
import { Field, Select } from '@/components/ui/form';
import { patch, useOrgMutation } from '../api';

const REACHES = ['own', 'branches', 'entity', 'group'] as const;

/** How far a role sees: only their own work, their branches, their legal entity, or the whole company. */
export function RoleReach({ roleId, reach, locked }: { roleId: string; reach?: string; locked: boolean }) {
  const { t } = useTranslation();
  const save = useOrgMutation((value: string) => patch(`/api/org/roles/${roleId}`, { reach: value }), {
    success: t('org.saved'),
  });
  const value = locked ? 'group' : (reach ?? 'group');
  return (
    <Field
      label={t('rolereach.label')}
      hint={locked ? t('rolereach.owner') : t(`rolereach.hint.${value}`)}
      className="max-w-md"
    >
      <Select
        value={value}
        disabled={locked || save.isPending}
        onChange={(e) => save.mutate(e.target.value)}
        aria-label={t('rolereach.label')}
      >
        {REACHES.map((r) => (
          <option key={r} value={r}>
            {t(`rolereach.${r}`)}
          </option>
        ))}
      </Select>
    </Field>
  );
}
