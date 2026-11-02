import { Camera, FileText, Loader2, Paperclip, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { uploadFile, type Uploaded } from '@/lib/upload';
import { cn } from '@/lib/utils';
import { Button } from './ui/button';

/** Drag-drop, browse, phone camera, or paste a screenshot (Ctrl+V). Uploads straight away. */
export function FileDrop({
  files,
  onChange,
  accept = 'image/*,application/pdf,.xlsx,.xls,.docx,.csv',
  pasteTarget = true,
}: {
  files: Uploaded[];
  onChange: (f: Uploaded[]) => void;
  accept?: string;
  pasteTarget?: boolean;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(0);
  const [over, setOver] = useState(false);
  const browse = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const latest = useRef(files);
  useEffect(() => {
    latest.current = files;
  }, [files]);

  const add = async (list: FileList | File[]) => {
    const arr = [...list];
    setBusy((b) => b + arr.length);
    for (const f of arr) {
      try {
        const up = await uploadFile(f, f.name || `screenshot-${Date.now()}.png`);
        latest.current = [...latest.current, up];
        onChange(latest.current);
      } catch (err) {
        toast.error((err as Error).message);
      } finally {
        setBusy((b) => b - 1);
      }
    }
  };

  useEffect(() => {
    if (!pasteTarget) return;
    const onPaste = (e: ClipboardEvent) => {
      const pasted = [...(e.clipboardData?.files ?? [])];
      if (pasted.length) {
        e.preventDefault();
        void add(pasted);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pasteTarget]);

  return (
    <div>
      <div
        onDragOver={(e) => (e.preventDefault(), setOver(true))}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void add(e.dataTransfer.files);
        }}
        className={cn(
          'flex flex-wrap items-center gap-2 rounded-card border border-dashed p-3 text-sm text-muted-foreground',
          over && 'border-ring bg-accent-soft/40',
        )}
      >
        <Button type="button" size="sm" onClick={() => browse.current?.click()}>
          <Paperclip /> {t('work.files.attach')}
        </Button>
        <Button type="button" size="sm" onClick={() => camera.current?.click()}>
          <Camera /> {t('work.files.camera')}
        </Button>
        <span className="hidden text-xs sm:inline">{t('work.files.hint')}</span>
        {busy > 0 && <Loader2 className="size-4 animate-spin" />}
        <input
          ref={browse}
          type="file"
          multiple
          accept={accept}
          className="hidden"
          onChange={(e) => e.target.files && void add(e.target.files)}
        />
        <input
          ref={camera}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => e.target.files && void add(e.target.files)}
        />
      </div>
      {files.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-2">
          {files.map((f) => (
            <li key={f.id} className="relative">
              {f.mime.startsWith('image/') ? (
                <img src={f.url} alt="" className="size-16 rounded-control border object-cover" />
              ) : (
                <span className="flex h-16 w-28 items-center gap-1.5 rounded-control border bg-muted px-2 text-xs">
                  <FileText className="size-4 shrink-0" />
                  <span className="truncate">{f.name}</span>
                </span>
              )}
              <button
                type="button"
                onClick={() => onChange(files.filter((x) => x.id !== f.id))}
                className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-ink text-ink-foreground"
                aria-label={t('org.remove')}
              >
                <X className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
