import { Boxes, Loader2, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { hasPermission, type Me } from '@mono/shared';
import { DictateButton } from '@/components/dictate';
import { EmptyState, ErrorState, PageHeader, PageSkeleton } from '@/components/page';
import { StatusChip } from '@/components/status-chip';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Select, Textarea } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { FieldsEditor } from '@/modules/fms/FieldsEditor';
import { aiApi, useAiMutation, useAiStatus, useMasters, type MasterDef, type MasterDraft } from './api';

const EMPTY: MasterDraft = { name: '', description: '', fields: [], keyField: null, displayField: null };

/**
 * Masters (CLAUDE.md §8): lists the whole company picks from. This phase: define them (by hand or with AI).
 * Rows, Excel import and the Master Library come in phase 10.
 */
export function MastersPage({ me }: { me: Me }) {
  const { t } = useTranslation();
  const location = useLocation();
  const q = useMasters();
  const ai = useAiStatus();
  const canEdit = hasPermission(me.user.permissions, 'core.edit');
  const [editing, setEditing] = useState<{ draft: MasterDraft; id?: string; source: 'ai' | 'own' } | null>(
    null,
  );
  const [asking, setAsking] = useState(location.pathname.endsWith('/build') && canEdit);
  const remove = useAiMutation(
    (id: string) => aiApi.deleteMaster(id),
    () => t('ai.master.deleted'),
  );

  return (
    <div className="space-y-5">
      <PageHeader title={t('nav.myMasters')} subtitle={t('ai.master.subtitle')} />
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            disabled={!ai.data?.connected}
            onClick={() => setAsking(true)}
            title={ai.data?.connected ? undefined : t('ai.connectFirst')}
          >
            <Sparkles /> {t('ai.master.build')}
          </Button>
          <Button variant="primary" onClick={() => setEditing({ draft: EMPTY, source: 'own' })}>
            <Plus /> {t('ai.master.new')}
          </Button>
        </div>
      )}
      {q.isPending ? (
        <PageSkeleton />
      ) : q.isError ? (
        <ErrorState onRetry={() => void q.refetch()} />
      ) : !q.data.length ? (
        <EmptyState icon={Boxes} title={t('ai.master.none')} body={t('ai.master.noneBody')} />
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {q.data.map((m) => (
            <li key={m.id} className="space-y-2 rounded-card border bg-card p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-semibold">{m.name}</div>
                  {m.description && <div className="text-sm text-muted-foreground">{m.description}</div>}
                </div>
                {m.source === 'ai' && <StatusChip tone="info">{t('ai.master.byAi')}</StatusChip>}
              </div>
              <div className="flex flex-wrap gap-1">
                {m.fields.map((f) => (
                  <span key={f.key} className="rounded-pill bg-muted px-2 py-0.5 text-[11px]">
                    {f.label}
                    {f.key === m.keyField && ' 🔑'}
                  </span>
                ))}
              </div>
              {canEdit && (
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setEditing({ draft: m, id: m.id, source: m.source === 'ai' ? 'ai' : 'own' })
                    }
                  >
                    <Pencil /> {t('common.edit')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      window.confirm(t('ai.master.confirmDelete', { name: m.name })) && remove.mutate(m.id)
                    }
                  >
                    <Trash2 /> {t('common.delete')}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">{t('ai.master.later')}</p>
      {asking && (
        <AskMaster
          onClose={() => setAsking(false)}
          onDraft={(draft) => (setAsking(false), setEditing({ draft, source: 'ai' }))}
        />
      )}
      {editing && <MasterEditor {...editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function AskMaster({ onClose, onDraft }: { onClose: () => void; onDraft: (d: MasterDraft) => void }) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const run = useAiMutation(() => aiApi.draftMaster(text));
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('ai.master.build')}
      description={t('ai.master.askHint')}
      footer={
        <Button
          variant="primary"
          disabled={text.trim().length < 5 || run.isPending}
          onClick={() => run.mutate(undefined, { onSuccess: onDraft })}
        >
          {run.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />} {t('ai.master.draft')}
        </Button>
      }
    >
      <div className="space-y-2">
        <Textarea
          rows={4}
          autoFocus
          className="font-sans"
          value={text}
          aria-label={t('ai.master.build')}
          placeholder={t('ai.master.askPlaceholder')}
          onChange={(e) => setText(e.target.value)}
        />
        <DictateButton onText={(v) => setText((x) => `${x} ${v}`.trim())} />
      </div>
    </Dialog>
  );
}

function MasterEditor({
  draft,
  id,
  source,
  onClose,
}: {
  draft: MasterDraft | MasterDef;
  id?: string;
  source: 'ai' | 'own';
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [m, setM] = useState<MasterDraft>({
    name: draft.name,
    description: draft.description ?? '',
    fields: draft.fields,
    keyField: draft.keyField,
    displayField: draft.displayField,
  });
  const save = useAiMutation(
    () => aiApi.saveMaster({ ...m, source }, id),
    () => t('org.saved'),
  );
  const pick = (value: string | null, onChange: (v: string | null) => void, label: string) => (
    <Field label={label}>
      <Select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">—</option>
        {m.fields.map((f) => (
          <option key={f.key} value={f.key}>
            {f.label}
          </option>
        ))}
      </Select>
    </Field>
  );
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={id ? t('ai.master.edit') : source === 'ai' ? t('ai.master.reviewTitle') : t('ai.master.new')}
      description={source === 'ai' && !id ? t('ai.master.reviewHint') : undefined}
      footer={
        <Button
          variant="primary"
          disabled={m.name.trim().length < 2 || !m.fields.length || save.isPending}
          onClick={() => save.mutate(undefined, { onSuccess: onClose })}
        >
          {save.isPending && <Loader2 className="animate-spin" />} {t('common.save')}
        </Button>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t('ai.master.name')}>
            <Input value={m.name} onChange={(e) => setM({ ...m, name: e.target.value })} />
          </Field>
          <Field label={t('ai.master.description')}>
            <Input
              value={m.description ?? ''}
              onChange={(e) => setM({ ...m, description: e.target.value })}
            />
          </Field>
          {pick(m.keyField, (keyField) => setM({ ...m, keyField }), t('ai.master.keyField'))}
          {pick(m.displayField, (displayField) => setM({ ...m, displayField }), t('ai.master.displayField'))}
        </div>
        <FieldsEditor fields={m.fields} onChange={(fields) => setM({ ...m, fields })} />
      </div>
    </Dialog>
  );
}
