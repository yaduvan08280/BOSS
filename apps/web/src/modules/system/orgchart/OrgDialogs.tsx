import { ClipboardList, Mail, Phone } from 'lucide-react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { OrgDepartment, OrgPerson } from '@mono/shared';
import { Avatar } from '@/components/brand';
import { StatusChip } from '@/components/status-chip';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Sheet, SheetContent } from '@/components/ui/sheet';

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
}: {
  person: OrgPerson | null;
  depts: Map<string, OrgDepartment>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
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
          <div className="rounded-card border bg-muted/40 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <ClipboardList className="size-4" /> {t('org.chart.openWork')}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{t('org.chart.openWorkSoon')}</p>
          </div>
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
