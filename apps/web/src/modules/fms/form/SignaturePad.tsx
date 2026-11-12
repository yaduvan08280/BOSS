import { Eraser } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { uploadFile, type Uploaded } from '@/lib/upload';

/** Draw with a finger or mouse; saved as an image. */
export function SignaturePad({ value, onChange }: { value?: Uploaded[]; onChange: (v: Uploaded[]) => void }) {
  const { t } = useTranslation();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [drawing, setDrawing] = useState(false);
  const [busy, setBusy] = useState(false);
  const pos = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return [
      ((e.clientX - r.left) * canvas.current!.width) / r.width,
      ((e.clientY - r.top) * canvas.current!.height) / r.height,
    ] as const;
  };
  const save = () =>
    canvas.current!.toBlob(async (blob) => {
      if (!blob) return;
      setBusy(true);
      try {
        onChange([await uploadFile(blob, `signature-${Date.now()}.png`)]);
      } finally {
        setBusy(false);
      }
    }, 'image/png');
  if (value?.length)
    return (
      <div className="flex items-center gap-3">
        <img src={value[0]!.url} alt={t('fms.signature')} className="h-16 rounded-control border bg-white" />
        <Button type="button" size="sm" variant="ghost" onClick={() => onChange([])}>
          <Eraser /> {t('fms.signAgain')}
        </Button>
      </div>
    );
  return (
    <div className="space-y-2">
      <canvas
        ref={canvas}
        width={600}
        height={160}
        aria-label={t('fms.signHere')}
        className="h-32 w-full touch-none rounded-control border bg-white"
        onPointerDown={(e) => {
          const ctx = canvas.current!.getContext('2d')!;
          ctx.lineWidth = 2.5;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(...pos(e));
          setDrawing(true);
        }}
        onPointerMove={(e) => {
          if (!drawing) return;
          const ctx = canvas.current!.getContext('2d')!;
          ctx.lineTo(...pos(e));
          ctx.stroke();
        }}
        onPointerUp={() => setDrawing(false)}
      />
      <Button type="button" size="sm" disabled={busy} onClick={save}>
        {t('fms.saveSignature')}
      </Button>
    </div>
  );
}
