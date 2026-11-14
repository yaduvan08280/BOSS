import { Settings2 } from 'lucide-react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { canOpenSystemMaster } from '@mono/shared';
import { Button } from '@/components/ui/button';
import { useMe } from '@/modules/auth/session';

/**
 * A shortcut from the floor (POS) or the front desk to where tables or rooms are set up, for the people who may
 * change them (owner and admins). Asked for 14/11/2026: the owner could not find where to add a room or a table.
 */
export function SetupLink({ part, outletId }: { part: 'floors' | 'rooms'; outletId?: string }) {
  const { t } = useTranslation();
  const me = useMe();
  if (!me.data || !canOpenSystemMaster(me.data.user.permissions)) return null;
  const to = `/system/hospitality?part=${part}${outletId ? `&outlet=${outletId}` : ''}`;
  return (
    <Button asChild variant="ghost" size="sm">
      <Link to={to}>
        <Settings2 /> {t(part === 'floors' ? 'hosp.setup.tables' : 'hosp.setup.rooms')}
      </Link>
    </Button>
  );
}
