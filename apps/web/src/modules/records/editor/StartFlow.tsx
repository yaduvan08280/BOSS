import { useTranslation } from 'react-i18next';
import type { RecordDefinition, RecordMove } from '@mono/shared';
import { Checkbox, Field, Select } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { useStartableFlows, type StartableFlow } from '../api';

/** Start-form fields whose value can't come from a record (they stay empty on the started process). */
const NOT_MAPPED = ['photo', 'file', 'signature', 'items'];

/** One start field's source as the two controls show it: a choice, and the words of a fixed text. */
const kindOf = (src: string | undefined) => (!src ? '' : src.startsWith('text:') ? 'text' : src);

/**
 * "This move starts a process": the published process, and for each field of its start form where the value
 * comes from — this record (as a link), its number, its title, one of its fields, or fixed words.
 */
export function StartFlow({
  move,
  def,
  typeId,
  onChange,
}: {
  move: RecordMove;
  def: RecordDefinition;
  /** The type being edited (absent while it is new): a start field that picks its records gets "this record". */
  typeId?: string;
  onChange: (startFlow: RecordMove['startFlow']) => void;
}) {
  const { t } = useTranslation();
  const flows = useStartableFlows();
  const start = move.startFlow;
  const list = flows.data ?? [];
  const flow = list.find((f) => f.id === start?.flowId);
  const usable = (f: StartableFlow['startFields'][number]) => !NOT_MAPPED.includes(f.type);

  /** A first guess: a field that picks this type's records gets the record; same-named fields are matched. */
  const guess = (f: StartableFlow) =>
    Object.fromEntries(
      f.startFields.filter(usable).flatMap((x) => {
        if (typeId && x.master === `rt:${typeId}`) return [[x.key, 'record']];
        const same = def.fields.find(
          (r) => r.key === x.key || r.label.trim().toLowerCase() === x.label.trim().toLowerCase(),
        );
        return same ? [[x.key, `field:${same.key}`]] : [];
      }),
    );
  const setSource = (key: string, src: string) => {
    if (!start) return;
    const map = { ...start.map };
    if (src) map[key] = src;
    else delete map[key];
    onChange({ ...start, map });
  };

  return (
    <div className="space-y-3 border-t pt-3">
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <Checkbox
          checked={Boolean(start)}
          disabled={!start && list.length === 0}
          onChange={(e) => {
            if (!e.target.checked) return onChange(undefined);
            const first = list[0];
            if (first) onChange({ flowId: first.id, map: guess(first) });
          }}
        />
        {t('recordsReach.start.toggle')}
      </label>
      {!start && flows.isSuccess && list.length === 0 && (
        <p className="text-xs text-muted-foreground">{t('recordsReach.start.none')}</p>
      )}
      {start && (
        <>
          <Field label={t('recordsReach.start.process')} hint={t('recordsReach.start.processHint')}>
            <Select
              value={flow ? start.flowId : ''}
              onChange={(e) => {
                const next = list.find((f) => f.id === e.target.value);
                if (next) onChange({ flowId: next.id, map: guess(next) });
              }}
            >
              {!flow && <option value="">{t('recordsReach.start.gone')}</option>}
              {list.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.code} · {f.name}
                </option>
              ))}
            </Select>
          </Field>
          {flow && flow.startFields.filter(usable).length > 0 && (
            <div className="space-y-2">
              <span className="text-sm font-medium">{t('recordsReach.start.values')}</span>
              {flow.startFields.filter(usable).map((f) => {
                const src = start.map[f.key];
                const kind = kindOf(src);
                const label = `${f.label}${f.required ? ' *' : ''}`;
                return (
                  <div
                    key={f.key}
                    className="grid grid-cols-1 gap-1.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]"
                  >
                    <span className="self-center text-sm text-muted-foreground">{label}</span>
                    <div className="space-y-1.5">
                      <Select
                        aria-label={t('recordsReach.start.from', { field: f.label })}
                        value={kind}
                        onChange={(e) =>
                          setSource(f.key, e.target.value === 'text' ? 'text:' : e.target.value)
                        }
                      >
                        <option value="">{t('recordsReach.start.src.empty')}</option>
                        <option value="record">{t('recordsReach.start.src.record')}</option>
                        <option value="code">{t('recordsReach.start.src.code')}</option>
                        <option value="title">{t('recordsReach.start.src.title')}</option>
                        {def.fields
                          .filter((r) => !['photo', 'file', 'signature', 'items'].includes(r.type))
                          .map((r) => (
                            <option key={r.key} value={`field:${r.key}`}>
                              {t('recordsReach.start.src.field', { field: r.label })}
                            </option>
                          ))}
                        <option value="text">{t('recordsReach.start.src.text')}</option>
                      </Select>
                      {kind === 'text' && (
                        <Input
                          aria-label={t('recordsReach.start.words', { field: f.label })}
                          placeholder={t('recordsReach.start.wordsPh')}
                          maxLength={200}
                          value={src!.slice(5)}
                          onChange={(e) => setSource(f.key, `text:${e.target.value}`)}
                        />
                      )}
                      {f.required && !src && (
                        <p className="text-xs text-status-bad-fg">{t('recordsReach.start.needed')}</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
