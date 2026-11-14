import { Plus, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorState, PageSkeleton } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { del, post, useDesignations, useOrgMutation } from '../api';

const COLORS = [
  '#E9A23B',
  '#2F5BD3',
  '#0F7B6C',
  '#B23A48',
  '#6E4BB8',
  '#5C8A2E',
  '#1695A3',
  '#D9822B',
  '#9C4F96',
  '#7A5C43',
];

export function Designations() {
  const { t } = useTranslation();
  const q = useDesignations();
  const [name, setName] = useState('');
  const add = useOrgMutation((n: string) =>
    post('/api/org/designations', { name: n, color: COLORS[(q.data?.length ?? 0) % COLORS.length] }),
  );
  const remove = useOrgMutation((id: string) => del(`/api/org/designations/${id}`));
  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} error={q.error} />;
  return (
    <Card className="max-w-3xl">
      <CardContent className="space-y-4 pt-5">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const n = name.trim();
            if (n) add.mutate(n, { onSuccess: () => setName('') });
          }}
        >
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('org.designations.placeholder')}
            aria-label={t('org.designations.add')}
          />
          <Button type="submit" variant="primary" disabled={!name.trim() || add.isPending}>
            <Plus /> <span className="hidden sm:inline">{t('org.designations.add')}</span>
          </Button>
        </form>
        <div className="flex flex-wrap gap-2">
          {q.data.map((d) => (
            <span
              key={d.id}
              className="inline-flex h-9 items-center gap-2 rounded-pill border bg-card pl-1 pr-2 text-sm"
            >
              <span
                className="grid size-7 place-items-center rounded-full text-xs font-bold text-white"
                style={{ background: d.color ?? '#6B6862' }}
              >
                {d.name[0]?.toUpperCase()}
              </span>
              {d.name}
              {d.people > 0 ? (
                <span
                  className="tabular text-xs text-muted-foreground"
                  title={t('org.peopleCount', { count: d.people })}
                >
                  {d.people}
                </span>
              ) : (
                <button
                  onClick={() => remove.mutate(d.id)}
                  className="grid size-5 place-items-center rounded-full text-muted-foreground hover:bg-muted"
                  aria-label={t('org.delete')}
                >
                  <X className="size-3.5" />
                </button>
              )}
            </span>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{t('org.designations.hint')}</p>
      </CardContent>
    </Card>
  );
}
