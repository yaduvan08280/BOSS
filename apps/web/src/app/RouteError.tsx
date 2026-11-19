import { RotateCw } from 'lucide-react';
import { Component, useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useRouteError } from 'react-router';
import { Button } from '@/components/ui/button';
import { reportError } from '@/lib/report-error';

/** After an update, a screen's code may no longer be on the server: that is "reload", not a crash. */
const isStale = (err: unknown) =>
  err instanceof Error && /dynamically imported module|Importing a module script failed/.test(err.message);

/** What a person sees when a screen stopped working: plain words and a way out. */
function CrashCard({ err }: { err: unknown }) {
  const { t } = useTranslation();
  const stale = isStale(err);
  return (
    <div role="alert" className="mx-auto max-w-md space-y-3 px-4 py-16 text-center">
      <h1 className="text-xl font-semibold">{stale ? t('errors.newVersion') : t('errors.crashed')}</h1>
      <p className="text-sm text-muted-foreground">
        {stale ? t('errors.newVersionBody') : t('errors.crashedBody')}
      </p>
      <Button onClick={() => window.location.reload()}>
        <RotateCw /> {t('errors.reload')}
      </Button>
    </div>
  );
}

/** A screen crashed: say so plainly, offer a reload, and report it. */
export function RouteError() {
  const err = useRouteError();
  useEffect(() => reportError(err), [err]);
  return <CrashCard err={err} />;
}

/**
 * The same around one page inside the app's frame: a screen that stops working leaves the menu and the top
 * bar in place, so the person can go somewhere else. `resetKey` (the address) clears it on the next screen.
 */
export class PageBoundary extends Component<
  { resetKey: string; children: ReactNode },
  { err: unknown; at: string | null }
> {
  override state: { err: unknown; at: string | null } = { err: null, at: null };
  static getDerivedStateFromError(err: unknown) {
    return { err };
  }
  static getDerivedStateFromProps(props: { resetKey: string }, state: { err: unknown; at: string | null }) {
    // The crash belongs to the address it happened on; another address starts clean.
    if (state.err && state.at === null) return { at: props.resetKey };
    if (state.err && state.at !== props.resetKey) return { err: null, at: null };
    return null;
  }
  override componentDidCatch(err: unknown) {
    reportError(err);
  }
  override render() {
    return this.state.err ? <CrashCard err={this.state.err} /> : this.props.children;
  }
}
