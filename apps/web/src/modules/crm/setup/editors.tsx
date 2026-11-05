import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { buildPlan, type CrmConfig, type PlanInput, type SetupPage } from '@mono/shared';
import { Confirm } from '@/components/ui/dialog';
import { ApiError } from '@/lib/api';
import { calendarOf, crmApi, useCrmMutation, type PlanData, type Progress } from '../api';

/** Edit some plan inputs locally (live preview with the same maths as the server), then save them. */
export function usePlanEditor(plan: PlanData, page: SetupPage, keys: (keyof PlanInput)[]) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<Partial<PlanInput>>({});
  const [ask, setAsk] = useState(false);
  const input = { ...plan.input, ...draft } as PlanInput;
  const key = JSON.stringify(input);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const view = useMemo(() => buildPlan(input, calendarOf(plan)), [key, plan]);
  const save = useCrmMutation(
    async (reset: boolean) => {
      const patch = Object.fromEntries(keys.map((k) => [k, input[k]]));
      const r = await crmApi.savePlan(patch, plan.fy, reset);
      await crmApi.markDone(page);
      return r;
    },
    () => t('crm.s.saved'),
  );
  const run = (reset = false) =>
    save.mutate(reset, {
      onSuccess: () => setDraft({}),
      onError: (e) => e instanceof ApiError && e.code === 'MONTHS_EDITED' && setAsk(true),
    });
  const confirm = (
    <Confirm
      open={ask}
      onOpenChange={setAsk}
      title={t('crm.s.monthsEditedTitle')}
      body={t('crm.s.monthsEditedBody')}
      confirm={t('crm.s.monthsEditedOk')}
      onConfirm={() => (setAsk(false), run(true))}
    />
  );
  return {
    input,
    view,
    set: (x: Partial<PlanInput>) => setDraft({ ...draft, ...x }),
    save: () => run(),
    saving: save.isPending,
    dirty: Object.keys(draft).length > 0,
    confirm,
    locked: !plan.canEdit,
  };
}

/** Edit some config keys locally, then save them as one page (which marks it done). */
export function useConfigEditor<K extends keyof CrmConfig>(progress: Progress, page: SetupPage, keys: K[]) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<Partial<Pick<CrmConfig, K>>>({});
  const value = { ...progress.config, ...draft } as CrmConfig;
  const save = useCrmMutation(
    () => crmApi.savePage(page, Object.fromEntries(keys.map((k) => [k, value[k]])) as Partial<CrmConfig>),
    () => t('crm.s.saved'),
  );
  return {
    value,
    set: (x: Partial<Pick<CrmConfig, K>>) => setDraft({ ...draft, ...x }),
    save: () => save.mutate(undefined, { onSuccess: () => setDraft({}) }),
    saving: save.isPending,
    dirty: Object.keys(draft).length > 0 || !progress.config.done.includes(page),
  };
}
