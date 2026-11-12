import { useTranslation } from 'react-i18next';
import { EVERYONE, RECORD_RIGHTS, type RecordPermissions, type RecordRight } from '@mono/shared';
import { Checkbox } from '@/components/ui/form';
import { defaultPermissions, type TabProps } from './draft';

type RoleOption = { id: string; name: string; key: string | null };

/**
 * Who may see, make, change and approve this type's records: everyone, or the roles ticked. Admins (and the
 * owner) always may. The API enforces this on every route — the screen only mirrors it.
 */
export function PermissionsTab({ draft, set, roles }: TabProps & { roles: RoleOption[] }) {
  const { t } = useTranslation();
  const p = draft.permissions ?? defaultPermissions(roles.find((r) => r.key === 'HOD')?.id);
  const toggle = (right: RecordRight, who: string, on: boolean) => {
    const next: RecordPermissions = {
      ...p,
      [right]: on ? [...p[right], who] : p[right].filter((x) => x !== who),
    };
    set({ permissions: next });
  };
  // The owner and admins hold every right through their role, so they are not listed.
  const rows = [
    { id: EVERYONE, name: t('records.perm.everyone') },
    ...roles.filter((r) => r.key !== 'OWNER' && r.key !== 'ADMIN'),
  ];
  return (
    <div className="max-w-3xl space-y-3">
      <p className="text-sm text-muted-foreground">{t('records.perm.hint')}</p>
      <div className="overflow-x-auto rounded-card border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/60 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">{t('records.perm.who')}</th>
              {RECORD_RIGHTS.map((r) => (
                <th key={r} className="w-14 px-1 py-2 text-center font-medium sm:w-24">
                  {t(`records.perm.${r}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t">
                <td className="px-3 py-1 font-medium">{row.name}</td>
                {RECORD_RIGHTS.map((r) => {
                  const all = row.id !== EVERYONE && p[r].includes(EVERYONE);
                  return (
                    <td key={r} className="p-0 text-center">
                      <label className="grid h-11 cursor-pointer place-items-center">
                        <Checkbox
                          aria-label={`${row.name}: ${t(`records.perm.${r}`)}`}
                          checked={all || p[r].includes(row.id)}
                          disabled={all}
                          onChange={(e) => toggle(r, row.id, e.target.checked)}
                        />
                      </label>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">{t('records.perm.adminNote')}</p>
    </div>
  );
}
