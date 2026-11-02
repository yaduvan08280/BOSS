import { useEffect, useState, type ReactNode } from 'react';
import { Sheet, SheetContent } from './sheet';

export function useIsPhone() {
  const query = '(max-width: 767px)';
  const [phone, setPhone] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setPhone(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return phone;
}

/** Centred dialog on desktop, bottom sheet on phones. */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const phone = useIsPhone();
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={phone ? 'bottom' : 'center'}
        title={title}
        description={description}
        className={wide ? 'md:max-w-3xl' : undefined}
      >
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-2 pt-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t px-5 py-3">{footer}</div>}
      </SheetContent>
    </Sheet>
  );
}

/** Ask before something that can't be undone easily. */
export function Confirm({
  open,
  onOpenChange,
  title,
  body,
  confirm,
  onConfirm,
  danger,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  body?: string;
  confirm: string;
  onConfirm: () => void;
  danger?: boolean;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      footer={
        <>
          <button
            className="h-10 rounded-control border bg-card px-4 text-sm font-medium hover:bg-muted"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </button>
          <button
            className={
              danger
                ? 'h-10 rounded-control bg-destructive px-4 text-sm font-medium text-destructive-foreground'
                : 'h-10 rounded-control bg-primary px-4 text-sm font-medium text-primary-foreground'
            }
            onClick={() => {
              onConfirm();
              onOpenChange(false);
            }}
          >
            {confirm}
          </button>
        </>
      }
    >
      {body && <p className="pb-2 text-sm text-muted-foreground">{body}</p>}
    </Dialog>
  );
}
