import { ExternalLink, Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { CrmConfig } from '@mono/shared';
import { ErrorState, PageSkeleton } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { crmApi, useCrmMutation, useProgress } from './api';

const TYPES = ['lead', 'quotation', 'customer', 'order'] as const;

/** System Master → Sales CRM (§4.2): your own fields per record type — label, show, required, + Add a field. */
export function CrmFieldsTab() {
  const q = useProgress();
  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} error={q.error} />;
  return <Fields key={JSON.stringify(q.data.config.fields)} saved={q.data.config.fields} />;
}

function Fields({ saved }: { saved: CrmConfig['fields'] }) {
  const { t } = useTranslation();
  const [fields, setFields] = useState(saved);
  const save = useCrmMutation(
    () => crmApi.saveFields(fields),
    () => t('crm.s.saved'),
  );
  const keyOf = (label: string, list: { key: string }[]) => {
    const base =
      label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .replace(/^(\d)/, 'f$1')
        .slice(0, 25) || 'field';
    let k = base;
    for (let n = 2; list.some((f) => f.key === k); n++) k = `${base}_${n}`;
    return k;
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link to="/crm/setup" className="inline-flex items-center gap-1 text-sm underline">
          <ExternalLink className="size-3.5" /> {t('crm.f.journey')}
        </Link>
        <Button
          disabled={save.isPending || JSON.stringify(fields) === JSON.stringify(saved)}
          onClick={() => save.mutate(undefined)}
        >
          {save.isPending ? <Loader2 className="animate-spin" /> : <Save />} {t('common.save')}
        </Button>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {TYPES.map((type) => {
          const list = fields[type];
          const put = (i: number, x: Partial<(typeof list)[number]>) =>
            setFields({ ...fields, [type]: list.map((f, k) => (k === i ? { ...f, ...x } : f)) });
          return (
            <Card key={type}>
              <CardHeader>
                <CardTitle>{t(`crm.f.type.${type}`)}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {!list.length && <p className="text-sm text-muted-foreground">{t('crm.f.none')}</p>}
                {list.map((f, i) => (
                  <div key={f.key} className="flex flex-wrap items-center gap-2">
                    <Input
                      aria-label={t('crm.f.label')}
                      value={f.label}
                      onChange={(e) => put(i, { label: e.target.value })}
                      className="min-w-0 flex-1"
                    />
                    <label className="flex items-center gap-1.5 text-xs">
                      <Switch checked={f.show} onCheckedChange={(show) => put(i, { show })} />{' '}
                      {t('crm.f.show')}
                    </label>
                    <label className="flex items-center gap-1.5 text-xs">
                      <Switch checked={f.required} onCheckedChange={(required) => put(i, { required })} />{' '}
                      {t('crm.f.required')}
                    </label>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={t('common.remove')}
                      onClick={() => setFields({ ...fields, [type]: list.filter((_, k) => k !== i) })}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                ))}
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={list.length >= 20}
                  onClick={() =>
                    setFields({
                      ...fields,
                      [type]: [
                        ...list,
                        {
                          key: keyOf(`${t('crm.f.newField')} ${list.length + 1}`, list),
                          label: `${t('crm.f.newField')} ${list.length + 1}`,
                          show: true,
                          required: false,
                        },
                      ],
                    })
                  }
                >
                  <Plus /> {t('crm.f.add')}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
