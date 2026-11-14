import qrcode from 'qrcode-generator';
import { Download } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';

/** The squares of a QR code for a text, as one SVG path (drawn in the browser; nothing is sent anywhere). */
function qrPath(text: string) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  let d = '';
  for (let y = 0; y < n; y += 1)
    for (let x = 0; x < n; x += 1) if (qr.isDark(y, x)) d += `M${x + 2} ${y + 2}h1v1h-1z`;
  return { d, size: n + 4 };
}

/** A link as a QR code to print for the tables and the bill. Always black on white, so any phone reads it. */
export function QrDialog({ title, url, onClose }: { title: string; url: string; onClose: () => void }) {
  const { t } = useTranslation();
  const { d, size } = useMemo(() => qrPath(url), [url]);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="1024" height="1024"><rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
  const download = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    a.download = `${title.replace(/[^\w-]+/g, '-').toLowerCase()}-qr.svg`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={title}
      footer={
        <Button variant="primary" onClick={download}>
          <Download /> {t('owner.u.qrSave')}
        </Button>
      }
    >
      <div className="mx-auto w-full max-w-64 rounded-control bg-white p-2">
        <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label={t('owner.u.qr')} className="block w-full">
          <path d={d} fill="#000" />
        </svg>
      </div>
      <p className="mt-3 text-center text-xs break-all text-muted-foreground">{url}</p>
      <p className="mt-2 text-center text-sm">{t('owner.u.qrHint')}</p>
    </Dialog>
  );
}
