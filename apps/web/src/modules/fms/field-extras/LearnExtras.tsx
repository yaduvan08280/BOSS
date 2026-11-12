import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Checkbox, Select } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { useListNames } from '@/modules/lists/api';
import { listSlug, listTitle } from '@/modules/lists/offer';
import type { ExtrasProps } from './types';

const NEW = '+new';

/** "Remember what people type" (§2.1): on / off, a shared named list, who may add values. Text fields only. */
export function LearnExtras({ field, onChange }: ExtrasProps) {
  const { t } = useTranslation();
  const on = field.type === 'text' && field.learn === true;
  const names = useListNames(on);
  // Typing the name of a new shared list: the box stays until the person leaves it.
  const [naming, setNaming] = useState(false);
  const [draft, setDraft] = useState('');
  if (field.type !== 'text') return null;

  const known = (names.data ?? []).map((n) => n.name);
  const shared = field.list && !known.includes(field.list) ? [...known, field.list] : known;
  const tick = 'flex min-h-11 cursor-pointer items-center gap-2.5 text-sm sm:min-h-9';
  return (
    <div className={on ? 'space-y-2 rounded-control bg-muted/50 px-3 py-2' : undefined}>
      <label className={tick}>
        <Checkbox
          checked={on}
          onChange={(e) =>
            // Off: every list setting goes, so the field reads exactly like one that never had them.
            onChange(
              e.target.checked
                ? { learn: true }
                : { learn: undefined, list: undefined, writeAllowed: undefined },
            )
          }
        />
        <span className="font-medium">{t('lists.x.remember')}</span>
      </label>
      {on && (
        <>
          <p className="text-xs text-muted-foreground">{t('lists.x.rememberHint')}</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Select
              aria-label={t('lists.x.which')}
              value={naming ? NEW : (field.list ?? '')}
              onChange={(e) => {
                const v = e.target.value;
                setNaming(v === NEW);
                setDraft('');
                onChange({ list: v && v !== NEW ? v : undefined });
              }}
            >
              <option value="">{t('lists.x.own')}</option>
              {shared.map((name) => (
                <option key={name} value={name}>
                  {t('lists.x.shared', { name: listTitle(name) })}
                </option>
              ))}
              <option value={NEW}>{t('lists.x.new')}</option>
            </Select>
            {naming && (
              <Input
                autoFocus
                aria-label={t('lists.x.name')}
                placeholder={t('lists.x.namePh')}
                value={draft}
                maxLength={40}
                onChange={(e) => {
                  setDraft(e.target.value);
                  onChange({ list: listSlug(e.target.value) || undefined });
                }}
                onBlur={() => setNaming(false)}
              />
            )}
          </div>
          {field.list && (
            <p className="text-xs text-muted-foreground">
              {t('lists.x.sharedHint', { name: listTitle(field.list) })}
            </p>
          )}
          <label className={tick}>
            <Checkbox
              checked={field.writeAllowed === false}
              onChange={(e) => onChange({ writeAllowed: e.target.checked ? false : undefined })}
            />
            <span>{t('lists.x.adminsOnly')}</span>
          </label>
          {field.writeAllowed === false && (
            <p className="text-xs text-muted-foreground">{t('lists.x.adminsOnlyHint')}</p>
          )}
        </>
      )}
    </div>
  );
}
