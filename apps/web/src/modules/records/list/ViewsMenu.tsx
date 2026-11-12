import { Bookmark, BookmarkPlus, Loader2, Trash2, Users } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { RecordViewConfig } from '@mono/shared';
import { Button } from '@/modules/records/ui';
import { Dialog } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Checkbox, Field } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { recordsApi, useRecordsMutation, useRecordViews, type SavedView } from '../api';

/** Saved views: the search, filters, sort and columns of the list, kept under a name — mine, or shared. */
export function ViewsMenu({
  typeId,
  current,
  canShare,
  canAdmin,
  onPick,
}: {
  typeId: string;
  current: RecordViewConfig;
  canShare: boolean;
  canAdmin: boolean;
  onPick: (v: SavedView) => void;
}) {
  const { t } = useTranslation();
  const views = useRecordViews(typeId).data ?? [];
  const [saving, setSaving] = useState(false);
  const remove = useRecordsMutation(
    (id: string) => recordsApi.deleteView(typeId, id),
    () => t('records.views.deleted'),
  );
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button>
            <Bookmark /> <span className="max-sm:sr-only">{t('records.views.title')}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-h-[70dvh] w-72 overflow-y-auto">
          {views.length === 0 && <DropdownMenuLabel>{t('records.views.none')}</DropdownMenuLabel>}
          {views.map((v) => (
            <div key={v.id} className="flex items-center">
              <DropdownMenuItem className="min-h-11 min-w-0 flex-1" onSelect={() => onPick(v)}>
                {v.shared ? <Users /> : <Bookmark />}
                <span className="truncate">{v.name}</span>
              </DropdownMenuItem>
              {(v.mine || canAdmin) && (
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={t('records.views.delete', { name: v.name })}
                  onClick={() => remove.mutate(v.id)}
                >
                  <Trash2 />
                </Button>
              )}
            </div>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem className="min-h-11" onSelect={() => setSaving(true)}>
            <BookmarkPlus /> {t('records.views.save')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {saving && (
        <SaveViewDialog
          typeId={typeId}
          config={current}
          canShare={canShare}
          onClose={() => setSaving(false)}
        />
      )}
    </>
  );
}

function SaveViewDialog({
  typeId,
  config,
  canShare,
  onClose,
}: {
  typeId: string;
  config: RecordViewConfig;
  canShare: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [shared, setShared] = useState(false);
  const save = useRecordsMutation(
    () => recordsApi.saveView(typeId, { name: name.trim(), shared, config }),
    (v) => t('records.views.saved', { name: v.name }),
  );
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('records.views.save')}
      description={t('records.views.saveHint')}
      footer={
        <Button
          variant="primary"
          disabled={!name.trim() || save.isPending}
          onClick={() => save.mutate(undefined, { onSuccess: onClose })}
        >
          {save.isPending && <Loader2 className="animate-spin" />} {t('common.save')}
        </Button>
      }
    >
      <div className="space-y-4 pb-2">
        <Field label={t('records.views.name')}>
          <Input autoFocus value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
        </Field>
        {canShare && (
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <Checkbox checked={shared} onChange={(e) => setShared(e.target.checked)} />
            {t('records.views.share')}
          </label>
        )}
      </div>
    </Dialog>
  );
}
