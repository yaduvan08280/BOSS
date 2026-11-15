import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/components/page';
import { Select } from '@/components/ui/form';
import { PropertyCtx as Ctx, usePropertyScope, type Named } from './scope-ctx';

/**
 * A hotel screen for one property, or — "All properties" — the same screen once per property, one under the
 * other, so an owner sees every hotel without switching. Each stacked view still works on its own property.
 */
export function EveryProperty({
  title,
  subtitle,
  list,
  children,
}: {
  title: string;
  subtitle?: string;
  list: Named[];
  children: () => ReactNode;
}) {
  const { t } = useTranslation();
  const [all, setAll] = useState(false);
  const [picked, setPicked] = useState('');
  const choose = (id: string) => {
    setAll(!id);
    if (id) setPicked(id);
  };
  if (!all || list.length < 2)
    return <Ctx.Provider value={{ picked, fixed: null, choose }}>{children()}</Ctx.Provider>;
  return (
    <div>
      <PageHeader title={title} subtitle={subtitle} />
      <div className="mb-4 w-full sm:w-64">
        <Select aria-label={t('hotel.property')} value="" onChange={(e) => choose(e.target.value)}>
          <option value="">{t('hotelAll.all')}</option>
          {list.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </div>
      <div className="space-y-8">
        {list.map((p) => (
          <section key={p.id} className="rounded-card border bg-card/40 p-3 sm:p-4">
            <Ctx.Provider value={{ picked: p.id, fixed: p, choose }}>{children()}</Ctx.Provider>
          </section>
        ))}
      </div>
    </div>
  );
}

/** The page's heading — or, stacked under "all properties", only its buttons (the page already has a heading). */
export function HotelHeader(props: { title: string; subtitle?: string; actions?: ReactNode }) {
  const scope = usePropertyScope();
  if (!scope?.fixed) return <PageHeader {...props} />;
  return props.actions ? <div className="mb-2 flex flex-wrap justify-end gap-2">{props.actions}</div> : null;
}
