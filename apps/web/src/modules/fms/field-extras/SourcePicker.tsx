import { useTranslation } from 'react-i18next';
import { parseSource, type FlowField } from '@mono/shared';
import { Select } from '@/components/ui/form';
import { useMasters } from '@/modules/ai/api';
import { useSourceColumns } from '@/modules/masters/api';
import { useFlows } from '../api';

const BUILT_IN = ['customers', 'items', 'vendors', 'people'] as const;
/** What MONO adds to every record's columns (number, title, status, started): not fields people typed in. */
const RECORD_FACTS = 4;

/**
 * Where a "from a master" field takes its choices: a built-in list, one of the company's masters, the values
 * typed in a field of another process (`fms:<flow>:<field>`) or a whole record of another process (`rec:<flow>`).
 * Changing the source drops the settings that named its columns (auto-fill, depends on, records to offer).
 */
export function SourcePicker({
  field,
  onChange,
}: {
  field: FlowField;
  onChange: (patch: Partial<FlowField>) => void;
}) {
  const { t } = useTranslation();
  const masters = useMasters();
  const flows = useFlows();
  const source = field.master ?? 'customers';
  const parsed = parseSource(source);
  // `fms` / `rec` with nothing chosen yet are kept as "fms:" / "rec:" until a process is picked.
  const kind = source.startsWith('fms:') ? 'fms' : source.startsWith('rec:') ? 'rec' : source;
  const flowId =
    parsed?.kind === 'fms' || parsed?.kind === 'rec' ? parsed.flowId : (source.split(':')[1] ?? '');
  const fields = useSourceColumns(kind === 'fms' && flowId ? `rec:${flowId}` : undefined);
  const set = (master: string) =>
    onChange({ master, fill: undefined, filterBy: undefined, recFilter: undefined });
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      <Select
        aria-label={t('fms.b.master')}
        value={kind}
        onChange={(e) =>
          set(e.target.value === 'fms' || e.target.value === 'rec' ? `${e.target.value}:` : e.target.value)
        }
      >
        {BUILT_IN.map((m) => (
          <option key={m} value={m}>
            {t(`fms.master.${m}`)}
          </option>
        ))}
        {(masters.data ?? []).map((m) => (
          <option key={m.id} value={`m:${m.id}`}>
            {m.name}
          </option>
        ))}
        <option value="fms">{t('links.src.fms')}</option>
        <option value="rec">{t('links.src.rec')}</option>
        {/* Record types (`rt:<id>`) are listed here by their own package. */}
      </Select>
      {(kind === 'fms' || kind === 'rec') && (
        <Select
          aria-label={t('links.src.process')}
          value={flowId}
          onChange={(e) => set(`${kind}:${e.target.value}`)}
        >
          <option value="">{t('links.src.pickProcess')}</option>
          {(flows.data ?? [])
            .filter((f) => f.status !== 'ARCHIVED')
            .map((f) => (
              <option key={f.id} value={f.id}>
                {f.code} · {f.name}
              </option>
            ))}
        </Select>
      )}
      {kind === 'fms' && flowId && (
        <Select
          aria-label={t('links.src.field')}
          value={parsed?.kind === 'fms' ? parsed.field : ''}
          onChange={(e) => set(`fms:${flowId}:${e.target.value}`)}
        >
          <option value="">{t('links.src.pickField')}</option>
          {(fields.data ?? []).slice(RECORD_FACTS).map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
            </option>
          ))}
        </Select>
      )}
    </div>
  );
}
