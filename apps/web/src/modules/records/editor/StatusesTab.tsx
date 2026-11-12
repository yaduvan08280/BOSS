import { ArrowRight, Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  MOVE_WHO,
  STATUS_TONES,
  type RecordDefinition,
  type RecordMove,
  type RecordStatus,
} from '@mono/shared';
import { StatusChip } from '@/components/status-chip';
import { Button } from '@/modules/records/ui';
import { Checkbox, Field, Select } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { keyFor } from '@/modules/fms/keys';
import type { TabProps } from './draft';
import { StartFlow } from './StartFlow';

type RoleOption = { id: string; name: string };

/** Statuses (each with one of the fixed status colours) and the moves between them, with who may make each. */
export function StatusesTab({
  draft,
  set,
  roles,
  typeId,
}: TabProps & { roles: RoleOption[]; typeId?: string }) {
  const { t } = useTranslation();
  const def = draft.definition;
  const save = (p: Partial<RecordDefinition>) => set({ definition: { ...def, ...p } });
  const setStatus = (i: number, p: Partial<RecordStatus>) =>
    save({ statuses: def.statuses.map((s, j) => (j === i ? { ...s, ...p } : s)) });
  const setMove = (i: number, p: Partial<RecordMove>) =>
    save({ moves: def.moves.map((m, j) => (j === i ? { ...m, ...p } : m)) });
  const open = def.statuses.filter((s) => !s.final);
  return (
    <div className="max-w-4xl space-y-8">
      <section className="space-y-3">
        <div>
          <h2 className="text-base font-semibold">{t('records.ed.statuses')}</h2>
          <p className="text-sm text-muted-foreground">{t('records.ed.statusesHint')}</p>
        </div>
        {def.statuses.map((s, i) => (
          <div key={s.key} className="space-y-2 rounded-control border bg-card p-3">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_220px_auto] sm:items-center">
              <Input
                aria-label={t('records.ed.statusName')}
                placeholder={t('records.ed.statusName')}
                value={s.label}
                maxLength={40}
                onChange={(e) => setStatus(i, { label: e.target.value })}
              />
              <Select
                aria-label={t('records.ed.statusKind')}
                value={s.kind}
                onChange={(e) => setStatus(i, { kind: e.target.value as RecordStatus['kind'] })}
              >
                {STATUS_TONES.map((k) => (
                  <option key={k} value={k}>
                    {t(`records.tone.${k}`)}
                  </option>
                ))}
              </Select>
              <div className="flex items-center justify-between gap-2">
                <StatusChip tone={s.kind}>{s.label || '—'}</StatusChip>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={t('records.ed.removeStatus')}
                  disabled={def.statuses.length === 1}
                  onClick={() =>
                    save({
                      statuses: def.statuses.filter((_, j) => j !== i),
                      // Its moves go with it.
                      moves: def.moves.filter((m) => m.from !== s.key && m.to !== s.key),
                      start:
                        def.start === s.key
                          ? (def.statuses.find((x) => x.key !== s.key)?.key ?? '')
                          : def.start,
                    })
                  }
                >
                  <Trash2 />
                </Button>
              </div>
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
              <label className="flex min-h-9 items-center gap-2">
                <input
                  type="radio"
                  name="record-start"
                  className="size-[18px] accent-[var(--primary)]"
                  checked={def.start === s.key}
                  onChange={() => save({ start: s.key })}
                />
                {t('records.ed.startsHere')}
              </label>
              <label className="flex min-h-9 items-center gap-2">
                <Checkbox
                  checked={Boolean(s.final)}
                  onChange={(e) => setStatus(i, { final: e.target.checked || undefined })}
                />
                {t('records.ed.final')}
              </label>
            </div>
          </div>
        ))}
        <Button
          size="sm"
          onClick={() => {
            const label = t('records.ed.newStatus', { n: def.statuses.length + 1 });
            const key = keyFor(
              label,
              def.statuses.map((s) => s.key),
            );
            save({ statuses: [...def.statuses, { key, label, kind: 'neutral' }] });
          }}
        >
          <Plus /> {t('records.ed.addStatus')}
        </Button>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-base font-semibold">{t('records.ed.moves')}</h2>
          <p className="text-sm text-muted-foreground">{t('records.ed.movesHint')}</p>
        </div>
        {def.moves.map((m, i) => (
          <div key={i} className="space-y-3 rounded-control border bg-card p-3">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_1fr_auto] sm:items-end">
              <Field label={t('records.ed.moveFrom')}>
                <Select
                  value={m.from}
                  onChange={(e) => {
                    // A move's key must be unique among the moves leaving the same status.
                    const from = e.target.value;
                    const taken = def.moves.filter((x, j) => j !== i && x.from === from).map((x) => x.action);
                    setMove(i, {
                      from,
                      action: taken.includes(m.action) ? keyFor(m.action, taken) : m.action,
                    });
                  }}
                >
                  {def.statuses.map((s) => (
                    <option key={s.key} value={s.key} disabled={Boolean(s.final)}>
                      {s.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <ArrowRight className="mb-3 hidden size-4 text-muted-foreground sm:block" aria-hidden />
              <Field label={t('records.ed.moveTo')}>
                <Select value={m.to} onChange={(e) => setMove(i, { to: e.target.value })}>
                  {def.statuses.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button
                size="icon"
                variant="ghost"
                aria-label={t('records.ed.removeMove')}
                onClick={() => save({ moves: def.moves.filter((_, j) => j !== i) })}
              >
                <Trash2 />
              </Button>
            </div>
            <Field label={t('records.ed.moveLabel')} hint={t('records.ed.moveLabelHint')}>
              <Input value={m.label} maxLength={40} onChange={(e) => setMove(i, { label: e.target.value })} />
            </Field>
            <div className="space-y-1.5">
              <span className="text-sm font-medium">{t('records.ed.moveWho')}</span>
              <div className="flex flex-wrap gap-1.5">
                {[
                  ...MOVE_WHO.map((w) => ({ token: w as string, name: t(`records.who.${w}`) })),
                  ...roles.map((r) => ({ token: `role:${r.id}`, name: r.name })),
                ].map(({ token, name }) => {
                  const on = m.who.includes(token);
                  return (
                    <button
                      key={token}
                      type="button"
                      aria-pressed={on}
                      onClick={() =>
                        setMove(i, { who: on ? m.who.filter((w) => w !== token) : [...m.who, token] })
                      }
                      className={cn(
                        'min-h-9 rounded-pill border px-3 text-sm',
                        on ? 'border-primary bg-primary/15 font-medium' : 'bg-card',
                      )}
                    >
                      {name}
                    </button>
                  );
                })}
              </div>
            </div>
            <label className="flex min-h-9 items-center gap-2 text-sm">
              <Checkbox
                checked={Boolean(m.noteRequired)}
                onChange={(e) => setMove(i, { noteRequired: e.target.checked || undefined })}
              />
              {t('records.ed.noteRequired')}
            </label>
            <StartFlow
              move={m}
              def={def}
              typeId={typeId}
              onChange={(startFlow) => setMove(i, { startFlow })}
            />
          </div>
        ))}
        <Button
          size="sm"
          disabled={open.length === 0 || def.statuses.length < 2}
          onClick={() => {
            const from = open[0]!.key;
            const to = def.statuses.find((s) => s.key !== from)!.key;
            const label = t('records.ed.newMove', { n: def.moves.length + 1 });
            const action = keyFor(
              label,
              def.moves.map((x) => x.action),
            );
            save({ moves: [...def.moves, { from, action, label, to, who: ['edit'] }] });
          }}
        >
          <Plus /> {t('records.ed.addMove')}
        </Button>
      </section>
    </div>
  );
}
