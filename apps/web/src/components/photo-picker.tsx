import { useQueryClient } from '@tanstack/react-query';
import { Camera, Loader2, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Avatar } from '@/components/brand';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { uploadFile } from '@/lib/upload';
import { cn } from '@/lib/utils';

/** A photo made small before it is sent: at most 640 px on its long side, as a JPEG. */
async function shrink(file: File): Promise<Blob> {
  try {
    const img = await createImageBitmap(file);
    const scale = Math.min(1, 640 / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/jpeg', 0.86));
    return blob ?? file;
  } catch {
    return file;
  }
}

/** A person's photo with a button to add, change or remove it (from the gallery or the phone's camera). */
export function PhotoPicker({
  personId,
  name,
  url,
  className,
}: {
  personId: string;
  name: string;
  url: string | null;
  className?: string;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState(url);

  const save = async (fileId: string | null) => {
    const res = await api<{ avatarUrl: string | null }>(`/api/org/users/${personId}/photo`, {
      method: 'PUT',
      body: { fileId },
    });
    setShown(res.avatarUrl);
    void qc.invalidateQueries({ queryKey: ['org'] });
    void qc.invalidateQueries({ queryKey: ['me'] });
  };
  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const up = await uploadFile(await shrink(file), 'photo.jpg');
      await save(up.id);
      toast.success(t('photo.saved'));
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };
  const remove = async () => {
    setBusy(true);
    try {
      await save(null);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={cn('flex items-center gap-3', className)}>
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={busy}
        aria-label={t(shown ? 'photo.change' : 'photo.add')}
        className="relative shrink-0 rounded-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <Avatar name={name} url={shown} className="size-16 text-lg" />
        <span className="absolute -right-1 -bottom-1 grid size-7 place-items-center rounded-full border bg-card text-foreground shadow-sm">
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Camera className="size-3.5" />}
        </span>
      </button>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => void pick(e.target.files?.[0])}
      />
      <div className="flex flex-wrap items-center gap-1.5">
        <Button variant="secondary" size="sm" onClick={() => input.current?.click()} disabled={busy}>
          {t(shown ? 'photo.change' : 'photo.add')}
        </Button>
        {shown && (
          <Button variant="ghost" size="sm" onClick={() => void remove()} disabled={busy}>
            <Trash2 /> {t('photo.remove')}
          </Button>
        )}
      </div>
    </div>
  );
}
