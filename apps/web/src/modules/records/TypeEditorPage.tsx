import { ArrowLeft, CircleAlert, CircleCheck, Loader2, Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { hasPermission, type Me, type RecordTypeInput } from '@mono/shared';
import { ErrorState, PageSkeleton } from '@/components/page';
import { StatusChip } from '@/components/status-chip';
import { Button } from '@/modules/records/ui';
import { TabStrip } from '@/components/work';
import { ApiError } from '@/lib/api';
import { FieldsEditor } from '@/modules/fms/FieldsEditor';
import { useRoles } from '@/modules/system/api';
import type { AiTypeDraft } from './AiDraftDialog';
import { recordsApi, useRecordsMutation, useRecordType, type RecordTypeView } from './api';
import { DetailsTab } from './editor/DetailsTab';
import { blankDraft, draftOf, problemsOf, type Draft } from './editor/draft';
import { LinesTab } from './editor/LinesTab';
import { LinkAdder } from './editor/LinkAdder';
import { PermissionsTab } from './editor/PermissionsTab';
import { StatusesTab } from './editor/StatusesTab';

const TABS = ['details', 'fields', 'lines', 'statuses', 'permissions'] as const;
type Tab = (typeof TABS)[number];

/** Set a record type up from the screen alone (U1): details, fields, child lines, statuses & moves, permissions. */
export function TypeEditorPage({ me }: { me: Me }) {
  const { id } = useParams();
  const q = useRecordType(id ?? '', Boolean(id));
  if (!hasPermission(me.user.permissions, 'records.admin')) return <ErrorState />;
  if (id && q.isPending) return <PageSkeleton />;
  if (id && q.isError) return <ErrorState onRetry={() => void q.refetch()} error={q.error} />;
  // A fresh editor for every saved version, so the draft never mixes two versions.
  return <Editor key={q.data?.updatedAt ?? 'new'} type={id ? q.data : undefined} />;
}

function Editor({ type }: { type?: RecordTypeView }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const roles = useRoles().data?.roles ?? [];
  // "Build with AI" opens the editor on its draft: unsaved, for a person to check, change and save.
  const ai = (useLocation().state as { aiDraft?: AiTypeDraft } | null)?.aiDraft;
  const fromAi = !type && Boolean(ai);
  const [draft, setDraft] = useState<Draft>(() =>
    type
      ? draftOf(type)
      : ai
        ? {
            ...blankDraft(),
            name: ai.name,
            pluralName: ai.pluralName,
            prefix: ai.prefix,
            description: ai.description,
            definition: ai.definition,
          }
        : blankDraft(),
  );
  const [tab, setTab] = useState<Tab>('details');
  const [dirty, setDirty] = useState(fromAi);
  const [refused, setRefused] = useState<string[]>([]);
  const set = (patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setDirty(true);
    setRefused([]);
  };
  const problems = useMemo(
    () =>
      problemsOf(draft, {
        name: t('records.ed.pName'),
        plural: t('records.ed.pPlural'),
        prefix: t('records.ed.pPrefix'),
        shape: t('records.ed.pShape'),
      }),
    [draft, t],
  );
  const ownSection = draft.menu.section !== null && !draft.menu.section.trim();
  const all = [...problems, ...(ownSection ? [t('records.ed.pSection')] : []), ...refused];
  const owner = type ? ({ kind: 'recordType', id: type.id } as const) : undefined;
  const save = useRecordsMutation(
    () => {
      const input: RecordTypeInput = {
        name: draft.name.trim(),
        pluralName: draft.pluralName.trim(),
        prefix: draft.prefix,
        description: draft.description.trim() || null,
        definition: draft.definition,
        menu: { ...draft.menu, section: draft.menu.section?.trim() ?? null },
        ...(draft.permissions ? { permissions: draft.permissions } : {}),
      };
      return type ? recordsApi.updateType(type.id, input) : recordsApi.createType(input);
    },
    () => t('records.ed.saved', { name: draft.name }),
  );
  const onSave = () =>
    save.mutate(undefined, {
      onSuccess: (r) => {
        setDirty(false);
        if (!type) navigate(`/records/types/${r.id}`, { replace: true });
      },
      onError: (e) => {
        const d = e instanceof ApiError ? (e.details as { problems?: string[] } | undefined) : undefined;
        setRefused(d?.problems ?? (e instanceof ApiError ? [e.message] : []));
      },
    });
  const fields = draft.definition.fields;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="ghost" size="sm" className="max-sm:order-1">
          <Link to="/records/types">
            <ArrowLeft /> {t('records.types.title')}
          </Link>
        </Button>
        {/* On phones the name gets a line of its own (it was squeezed to one letter beside the buttons). */}
        <h1 className="min-w-0 flex-1 truncate text-lg font-semibold max-sm:order-3 max-sm:basis-full sm:text-xl">
          {draft.name || t('records.types.new')}
        </h1>
        <span className="max-sm:order-2 max-sm:ml-auto">
          {all.length ? (
            <StatusChip tone="warn">{t('records.ed.toFix', { count: all.length })}</StatusChip>
          ) : (
            <StatusChip tone="ok">{t('records.ed.ready')}</StatusChip>
          )}
        </span>
        {type && (
          <Button asChild variant="secondary" size="sm" className="max-sm:order-4">
            <Link to={`/records/${type.id}`}>{t('records.ed.openList')}</Link>
          </Button>
        )}
        <Button
          className="max-sm:order-4"
          disabled={problems.length > 0 || ownSection || save.isPending || (!dirty && !!type)}
          onClick={onSave}
        >
          {save.isPending && <Loader2 className="animate-spin" />} {t('common.save')}
        </Button>
      </div>
      {fromAi && (
        <p className="flex items-center gap-2 rounded-card border bg-card p-3 text-sm">
          <Sparkles className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          {t('recordsReach.ai.drafted')}
        </p>
      )}
      {all.length > 0 ? (
        <div
          role="alert"
          className="rounded-card border border-status-warn-fg/30 bg-status-warn-bg p-3 text-sm text-status-warn-fg"
        >
          <div className="flex items-center gap-2 font-semibold">
            <CircleAlert className="size-4" aria-hidden /> {t('records.ed.fixTitle')}
          </div>
          <ul className="mt-1.5 list-disc space-y-0.5 pl-6">
            {all.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <CircleCheck className="size-4 text-status-ok" aria-hidden />
          {type && type.records
            ? t('records.ed.readyWith', { count: type.records })
            : t('records.ed.readyBody')}
        </p>
      )}
      <TabStrip
        tabs={TABS}
        active={tab}
        onChange={setTab}
        label={(k) => t(`records.ed.tab.${k}`)}
        counts={{
          fields: fields.length,
          lines: draft.definition.tables.length,
          statuses: draft.definition.statuses.length,
        }}
      />
      {tab === 'details' && <DetailsTab draft={draft} set={set} isNew={!type} />}
      {tab === 'fields' && (
        <div className="max-w-4xl space-y-3">
          <p className="text-sm text-muted-foreground">{t('records.ed.fieldsHint')}</p>
          <FieldsEditor
            fields={fields}
            onChange={(next) => set({ definition: { ...draft.definition, fields: next } })}
            owner={owner}
          />
          <LinkAdder
            typeId={type?.id}
            fields={fields}
            onAdd={(f) => set({ definition: { ...draft.definition, fields: [...fields, f] } })}
          />
        </div>
      )}
      {tab === 'lines' && <LinesTab draft={draft} set={set} owner={owner} typeId={type?.id} />}
      {tab === 'statuses' && <StatusesTab draft={draft} set={set} roles={roles} typeId={type?.id} />}
      {tab === 'permissions' && <PermissionsTab draft={draft} set={set} roles={roles} />}
    </div>
  );
}
