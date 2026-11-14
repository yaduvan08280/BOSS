import { Building2, Eye, Mail, Phone } from 'lucide-react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { OrgDepartment, OrgPerson } from '@mono/shared';
import { Avatar } from '@/components/brand';
import { StatusChip } from '@/components/status-chip';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { currentViewAs, lookAs } from '@/lib/view-as';
import { useMe } from '@/modules/auth/session';
import { useBranches } from '../api';
import { OpenWork } from './OpenWork';

export type PendingMove = { person: OrgPerson; from: OrgDepartment | null; to: OrgDepartment };

/** "Sandeep Pal → IT. What should happen?" */
export function MoveDialog({
  move,
  onChoose,
  onCancel,
}: {
  move: PendingMove | null;
  onChoose: (mode: 'also' | 'move') => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  if (!move) return null;
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onCancel()}
      title={t('org.chart.moveTitle', { name: move.person.name, to: move.to.name })}
      description={t('org.chart.moveQuestion')}
    >
      <div className="grid gap-2 pb-3">
        <Button className="h-auto justify-start py-3 text-left" onClick={() => onChoose('also')}>
          <span>
            <span className="block font-semibold">{t('org.chart.alsoAdd', { to: move.to.name })}</span>
            <span className="block text-xs font-normal text-muted-foreground">
              {t('org.chart.worksInBoth')}
            </span>
          </span>
        </Button>
        {move.from && (
          <Button className="h-auto justify-start py-3 text-left" onClick={() => onChoose('move')}>
            <span>
              <span className="block font-semibold">{t('org.chart.moveTo', { to: move.to.name })}</span>
              <span className="block text-xs font-normal text-muted-foreground">
                {t('org.chart.leaves', { from: move.from.name })}
              </span>
            </span>
          </Button>
        )}
        <Button variant="ghost" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
      </div>
    </Dialog>
  );
}

/** Click a person → details and their open work. */
export function PersonPanel({
  person,
  depts,
  onClose,
  onPlace,
}: {
  person: OrgPerson | null;
  depts: Map<string, OrgDepartment>;
  onClose: () => void;
  /** Open the "where they work" dialog (transfer to another branch). */
  onPlace?: (p: OrgPerson) => void;
}) {
  const { t } = useTranslation();
  const branches = useBranches().data ?? [];
  const me = useMe().data;
  if (!person) return null;
  const row = (label: string, value: React.ReactNode) => (
    <div className="flex justify-between gap-4 border-b py-2.5 text-sm last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value ?? '—'}</span>
    </div>
  );
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" title={person.name} description={person.designationName ?? person.roleName}>
        <div className="space-y-5 overflow-y-auto px-5 py-4">
          <div className="flex items-center gap-4">
            <Avatar name={person.name} url={person.avatarUrl} className="size-16 text-lg" />
            <div className="space-y-1.5">
              <StatusChip
                tone={person.status === 'ACTIVE' ? 'ok' : person.status === 'LEFT' ? 'bad' : 'neutral'}
              >
                {t(`org.status.${person.status}`)}
              </StatusChip>
              <div className="flex gap-1.5">
                {person.mobile && (
                  <Button asChild size="icon-sm">
                    <a href={`tel:${person.mobile}`} aria-label={t('org.mobile')}>
                      <Phone />
                    </a>
                  </Button>
                )}
                {person.email && (
                  <Button asChild size="icon-sm">
                    <a href={`mailto:${person.email}`} aria-label={t('org.email')}>
                      <Mail />
                    </a>
                  </Button>
                )}
              </div>
            </div>
          </div>
          <div>
            {row(t('org.users.code'), <span className="font-mono">{person.code}</span>)}
            {row(t('org.place.branch'), person.branchName ?? t('org.place.noBranch'))}
            {(person.alsoBranchIds?.length ?? 0) > 0 &&
              row(
                t('org.place.also'),
                person.alsoBranchIds!.map((b) => branches.find((x) => x.id === b)?.name).join(', '),
              )}
            {row(
              t('org.users.mainDept'),
              person.mainDepartmentId ? depts.get(person.mainDepartmentId)?.name : null,
            )}
            {row(
              t('org.users.alsoWorksIn'),
              person.alsoWorksIn.map((d) => depts.get(d)?.name).join(', ') || null,
            )}
            {row('HOD', person.hodOf.map((d) => depts.get(d)?.name).join(', ') || null)}
            {row(t('org.users.role'), person.roleName)}
            {row(t('org.users.reportsTo'), person.reportsToName)}
            {row(
              t('org.users.login'),
              person.loginEnabled ? (person.mobile ?? person.email) : t('org.users.loginOff'),
            )}
          </div>
          {onPlace && (
            <Button className="w-full" onClick={() => onPlace(person)}>
              <Building2 /> {t('org.place.transfer')}
            </Button>
          )}
          {me?.user.roleKey === 'OWNER' && person.id !== me.user.id && !currentViewAs() && (
            <Button className="w-full" onClick={() => void lookAs(person.id)}>
              <Eye /> {t('shadow.look')}
            </Button>
          )}
          <OpenWork personId={person.id} />
          <Button asChild className="w-full">
            <Link to={`/system/users?dept=${person.mainDepartmentId ?? ''}`}>
              {t('org.chart.editInUsers')}
            </Link>
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
