import { ExternalLink } from 'lucide-react';
import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { plainValues, refsOf, type FlowField } from '@mono/shared';
import type { ResolvedLink } from '@/modules/masters/api';
import { showValue } from './show';

type Links = Record<string, ResolvedLink> | undefined;

/**
 * A saved value. When it was picked from a row or a record, it opens what it came from; if that has been renamed
 * since, its name today is shown beside the text that was saved (history is never rewritten).
 */
export function LinkedText({ text, link }: { text: string; link?: ResolvedLink }) {
  const { t } = useTranslation();
  if (!link) return <>{text}</>;
  const renamed = link.label.trim().toLowerCase() !== text.trim().toLowerCase();
  return (
    <>
      {link.to ? (
        <Link
          to={link.to}
          aria-label={t('links.open', { name: link.label })}
          className="inline-flex items-center gap-1 underline decoration-dotted underline-offset-2 hover:text-primary"
        >
          {text} <ExternalLink className="size-3 shrink-0" aria-hidden />
        </Link>
      ) : (
        text
      )}
      {renamed && (
        <span className="font-normal text-muted-foreground">
          {' '}
          ({t('links.nowCalled', { name: link.label })})
        </span>
      )}
    </>
  );
}

/** One value of a form, shown the way people read it, with its link when it has one. */
export function FieldValue({
  field,
  data,
  links,
  tz,
}: {
  field: FlowField;
  data: Record<string, unknown>;
  links: Links;
  tz: string;
}) {
  const { t } = useTranslation();
  const shown = showValue(field, data[field.key], tz, [t('fms.yes'), t('fms.no')]);
  if (!shown) return null;
  const ref = refsOf(data)[field.key];
  return <LinkedText text={shown} link={ref ? links?.[ref] : undefined} />;
}

/** What was entered on a step: "PO number: 4411 · Vendor: Shree Minerals". */
export function StepValues({
  data,
  fields,
  links,
  tz,
}: {
  data: Record<string, unknown>;
  fields: FlowField[];
  links: Links;
  tz: string;
}) {
  const { t } = useTranslation();
  const refs = refsOf(data);
  const shown = Object.entries(plainValues(data)).flatMap(([k, v]) => {
    const f = fields.find((x) => x.key === k);
    const text = showValue(f, v, tz, [t('fms.yes'), t('fms.no')]);
    return text ? [{ k, label: f?.label ?? k, text }] : [];
  });
  if (!shown.length) return null;
  return (
    <div className="mt-1 text-xs text-muted-foreground">
      {shown.map((x, i) => (
        <Fragment key={x.k}>
          {i > 0 && ' · '}
          {x.label}: <LinkedText text={x.text} link={refs[x.k] ? links?.[refs[x.k]!] : undefined} />
        </Fragment>
      ))}
    </div>
  );
}
