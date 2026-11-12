import { useTranslation } from 'react-i18next';
import { financialYear, RECORD_ICONS } from '@mono/shared';
import { Field, Select, Textarea } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { RECORD_ICON } from '../icons';
import { RECORD_MENU_SECTIONS } from '../menu';
import { suggestPrefix, type TabProps } from './draft';

const OWN = '__own__';
const HIDDEN = '__hidden__';

/** Name, number series, title field and the place in the left menu. */
export function DetailsTab({ draft, set, isNew }: TabProps & { isNew: boolean }) {
  const { t } = useTranslation();
  const section = draft.menu.section;
  const place = section === null ? HIDDEN : RECORD_MENU_SECTIONS.includes(section) ? section : OWN;
  const titleFields = draft.definition.fields.filter((f) =>
    ['text', 'master', 'dropdown', 'number', 'mobile'].includes(f.type),
  );
  return (
    <div className="grid max-w-3xl grid-cols-1 gap-4 sm:grid-cols-2">
      <Field label={`${t('records.ed.name')} *`} hint={t('records.ed.nameHint')}>
        <Input
          value={draft.name}
          maxLength={60}
          onChange={(e) => {
            const name = e.target.value;
            // Until they are typed by hand, the plural and the prefix follow the name.
            const follow = isNew && (!draft.pluralName || draft.pluralName === `${draft.name}s`);
            const prefix = isNew && (!draft.prefix || draft.prefix === suggestPrefix(draft.name));
            set({
              name,
              ...(follow ? { pluralName: name ? `${name}s` : '' } : {}),
              ...(prefix ? { prefix: suggestPrefix(name) } : {}),
            });
          }}
        />
      </Field>
      <Field label={`${t('records.ed.plural')} *`} hint={t('records.ed.pluralHint')}>
        <Input
          value={draft.pluralName}
          maxLength={60}
          onChange={(e) => set({ pluralName: e.target.value })}
        />
      </Field>
      <Field
        label={`${t('records.ed.prefix')} *`}
        hint={t('records.ed.prefixHint', {
          example: `${draft.prefix || 'SV'}/${financialYear(new Date()).short}/0001`,
        })}
      >
        <Input
          value={draft.prefix}
          maxLength={8}
          className="font-mono uppercase"
          onChange={(e) => set({ prefix: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })}
        />
      </Field>
      <Field label={t('records.ed.titleField')} hint={t('records.ed.titleFieldHint')}>
        <Select
          value={draft.definition.displayField ?? ''}
          onChange={(e) =>
            set({ definition: { ...draft.definition, displayField: e.target.value || undefined } })
          }
        >
          <option value="">{t('records.ed.titleAuto')}</option>
          {titleFields.map((f) => (
            <option key={f.key} value={f.key}>
              {f.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t('records.ed.description')} className="sm:col-span-2">
        <Textarea
          className="min-h-20 font-sans"
          rows={2}
          maxLength={300}
          value={draft.description}
          onChange={(e) => set({ description: e.target.value })}
        />
      </Field>
      <Field label={t('records.ed.menuPlace')} hint={t('records.ed.menuPlaceHint')}>
        <Select
          value={place}
          onChange={(e) => {
            const v = e.target.value;
            set({ menu: { ...draft.menu, section: v === HIDDEN ? null : v === OWN ? '' : v } });
          }}
        >
          {RECORD_MENU_SECTIONS.map((s) => (
            <option key={s} value={s}>
              {t(`section.${s}`)}
            </option>
          ))}
          <option value={OWN}>{t('records.ed.menuOwn')}</option>
          <option value={HIDDEN}>{t('records.ed.menuHidden')}</option>
        </Select>
      </Field>
      {place === OWN && (
        <Field label={`${t('records.ed.menuOwnName')} *`}>
          <Input
            value={section ?? ''}
            maxLength={30}
            placeholder={t('records.ed.menuOwnPh')}
            onChange={(e) => set({ menu: { ...draft.menu, section: e.target.value } })}
          />
        </Field>
      )}
      <div className="space-y-1.5 sm:col-span-2">
        <span className="text-sm font-medium">{t('records.ed.icon')}</span>
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t('records.ed.icon')}>
          {RECORD_ICONS.map((name) => {
            const Icon = RECORD_ICON[name];
            const on = draft.menu.icon === name;
            return (
              <button
                key={name}
                type="button"
                role="radio"
                aria-checked={on}
                aria-label={name}
                title={name}
                onClick={() => set({ menu: { ...draft.menu, icon: name } })}
                className={cn(
                  'grid size-11 place-items-center rounded-control border',
                  on ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:bg-muted',
                )}
              >
                <Icon className="size-5" aria-hidden />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
