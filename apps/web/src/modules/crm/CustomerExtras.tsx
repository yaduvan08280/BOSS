import { FileUp, Loader2, Plus, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CrmConfig } from '@mono/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { crmApi, useCrmMutation } from './api';

/** Paste a list or open a CSV: Name, City, Mobile, Email, Segment, Credit days. */
export function ImportCustomers({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const save = useCrmMutation(
    () => crmApi.importCustomers(text),
    (r) => t('crm.c.imported', { count: r.created }),
  );
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={t('crm.c.import')}
      description={t('crm.c.importHint')}
      wide
      footer={
        <Button
          disabled={!text.trim() || save.isPending}
          onClick={() => save.mutate(undefined, { onSuccess: () => (setText(''), onClose()) })}
        >
          {save.isPending && <Loader2 className="animate-spin" />} {t('crm.c.import')}
        </Button>
      }
    >
      <div className="space-y-3">
        <Button variant="secondary" onClick={() => file.current?.click()}>
          <FileUp /> {t('task.openFile')}
        </Button>
        <input
          ref={file}
          type="file"
          accept=".csv,.tsv,.txt"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) setText(await f.text());
          }}
        />
        <Textarea
          rows={8}
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label={t('crm.c.import')}
          placeholder={
            'Name\tCity\tMobile\tEmail\tSegment\tCredit days\nShree Tiles\tAjmer\t9829012345\t\tdealer\t30'
          }
        />
      </div>
    </Dialog>
  );
}

/** Fields & tags: what the automatic tags mean (from the customer rules) and your own tags (name + colour). */
export function TagsDialog({ config, onClose }: { config: CrmConfig; onClose: () => void }) {
  const { t } = useTranslation();
  const [tags, setTags] = useState(config.tags);
  const save = useCrmMutation(
    () => crmApi.saveTagDefs(tags),
    () => t('crm.s.saved'),
  );
  const r = config.customers;
  const keyOf = (name: string) =>
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 30) || `tag_${tags.length + 1}`;
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('crm.c.fieldsTags')}
      wide
      footer={
        <Button
          disabled={save.isPending || tags.some((x) => !x.name.trim())}
          onClick={() => save.mutate(undefined, { onSuccess: onClose })}
        >
          {save.isPending && <Loader2 className="animate-spin" />} {t('common.save')}
        </Button>
      }
    >
      <div className="space-y-4 text-sm">
        <ul className="space-y-1.5">
          {(['top20', 'bottom20', 'new', 'sleeping', 'lost', 'vampire', 'owners'] as const).map((k) => (
            <li key={k}>
              <b>{t(`crm.tag.${k}`)}</b> —{' '}
              {t(`crm.tagRule.${k}`, {
                orders: r.newOrders,
                newDays: r.newDays,
                sleeping: r.sleepingDays,
                lost: r.lostDays,
              })}
              {k === 'vampire' && !r.vampire && ` (${t('crm.c.off')})`}
            </li>
          ))}
        </ul>
        <div className="space-y-2">
          <div className="font-medium">{t('crm.c.ownTags')}</div>
          {tags.map((x, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="color"
                aria-label={t('crm.c.tagColour', { name: x.name })}
                value={x.color}
                onChange={(e) => setTags(tags.map((y, k) => (k === i ? { ...y, color: e.target.value } : y)))}
                className="size-9 rounded-control border bg-card"
              />
              <Input
                aria-label={t('crm.c.tagName')}
                value={x.name}
                onChange={(e) => setTags(tags.map((y, k) => (k === i ? { ...y, name: e.target.value } : y)))}
                className="max-w-xs"
              />
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={t('common.remove')}
                onClick={() => setTags(tags.filter((_, k) => k !== i))}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
          <Button
            size="sm"
            variant="secondary"
            disabled={tags.length >= 30}
            onClick={() =>
              setTags([
                ...tags,
                {
                  key: keyOf(`${t('crm.c.newTag')} ${tags.length + 1}`),
                  name: `${t('crm.c.newTag')} ${tags.length + 1}`,
                  color: '#64748b',
                },
              ])
            }
          >
            <Plus /> {t('crm.c.addTag')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
