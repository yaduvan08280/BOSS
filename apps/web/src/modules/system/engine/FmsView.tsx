import { Workflow } from 'lucide-react';
import { useMemo } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { PageSkeleton } from '@/components/page';
import { Button } from '@/components/ui/button';
import { FmsChart } from '@/modules/fms/FmsChart';
import { useFlow } from '@/modules/fms/api';
import { useUsers } from '../api';

const none = new Set<string>();
const noop = () => {};

/** A company's own FMS process as a read-only chart (the builder's own drawing). */
export function FmsView({ id, loading }: { id: string | undefined; loading: boolean }) {
  const { t } = useTranslation();
  const q = useFlow(id);
  const people = useUsers().data;
  const names = useMemo(() => new Map((people ?? []).map((p) => [p.id, p.name])), [people]);
  if (loading || (id && q.isPending)) return <PageSkeleton />;
  if (!id || !q.data)
    return (
      <div className="space-y-3 p-6 text-sm text-muted-foreground">
        <p>{t('flows.noFms')}</p>
        <Button asChild size="sm">
          <Link to="/fms/builder">
            <Workflow /> {t('flows.buildOne')}
          </Link>
        </Button>
      </div>
    );
  return (
    <div className="p-3">
      <FmsChart def={q.data.definition} names={names} toFix={none} selected={null} onSelect={noop} />
    </div>
  );
}
