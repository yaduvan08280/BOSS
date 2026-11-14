import { ArrowRight, ArrowUpRight, Cog, Workflow } from 'lucide-react';
import { useMemo } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { PROCESS_GROUPS, PROCESSES, processDef, processesInto, processGraph } from '@mono/shared';
import { Button } from '@/components/ui/button';
import type { FlowListItem } from '@/modules/fms/api';

/** The right-hand panel for a process MONO runs by itself: where it is done, who does what, what it connects to. */
export function ProcessInfo({ process, onOpen }: { process: string; onOpen: (key: string) => void }) {
  const { t } = useTranslation();
  const def = processDef(process);
  const graph = useMemo(() => processGraph(process), [process]);
  if (!def || !graph) return null;
  // Who does which step: each role with the steps it may take.
  const byRole = new Map<string, Set<string>>();
  for (const n of graph.nodes)
    if (n.kind === 'action' || n.kind === 'auto')
      for (const r of n.roles.filter((r) => r !== 'admin' && r !== 'any'))
        byRole.set(r, (byRole.get(r) ?? new Set()).add(t([`flows.act.${n.key}`, `engine.act.${n.key}`])));
  const out = (def.links ?? []).map((l) => ({ to: l.to, key: l.key }));
  const into = processesInto(process);
  const link = (key: string, text: string, i: number) => (
    <li key={`${key}-${i}`}>
      <button
        type="button"
        onClick={() => onOpen(key)}
        className="flex w-full items-start gap-2 rounded-control p-2 text-left text-sm hover:bg-muted"
      >
        <ArrowUpRight className="mt-0.5 size-4 shrink-0 text-primary" />
        <span className="min-w-0">
          <span className="block font-medium">{t(`flows.p.${key}`)}</span>
          <span className="block text-xs text-muted-foreground">{text}</span>
        </span>
      </button>
    </li>
  );

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <h3 className="text-base font-semibold">{t(`flows.p.${process}`)}</h3>
        <p className="text-sm text-muted-foreground">{t(`flows.d.${process}`)}</p>
        <Button asChild size="sm">
          <Link to={def.screen}>
            {t('flows.openScreen')} <ArrowRight />
          </Link>
        </Button>
      </div>

      <section className="space-y-1.5">
        <h4 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          {t('flows.leadsTo')}
        </h4>
        {out.length ? (
          <ul>{out.map((l, i) => link(l.to, t(`flows.link.${l.key}`), i))}</ul>
        ) : (
          <p className="text-sm text-muted-foreground">{t('flows.nothing')}</p>
        )}
      </section>

      <section className="space-y-1.5">
        <h4 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          {t('flows.comesFrom')}
        </h4>
        {into.length ? (
          <ul>{into.map((l, i) => link(l.from, t(`flows.link.${l.key}`), i))}</ul>
        ) : (
          <p className="text-sm text-muted-foreground">{t('flows.nothing')}</p>
        )}
      </section>

      <section className="space-y-1.5">
        <h4 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          {t('flows.who')}
        </h4>
        <ul className="space-y-1.5 text-sm">
          {[...byRole].map(([role, steps]) => (
            <li key={role}>
              <span className="font-medium">
                {role === 'system' ? (
                  <span className="inline-flex items-center gap-1">
                    <Cog className="size-3.5" /> {t('flows.auto')}
                  </span>
                ) : (
                  t([`engine.role.${role}`, `flows.role.${role}`])
                )}
              </span>
              <span className="text-muted-foreground"> · {[...steps].join(', ')}</span>
            </li>
          ))}
        </ul>
      </section>

      <div className="space-y-2 border-t pt-4">
        <p className="text-xs text-muted-foreground">{t('flows.rules')}</p>
        <Button asChild size="sm" variant="ghost">
          <Link to="/system/integration/rules">
            <Workflow /> {t('flows.editRules')}
          </Link>
        </Button>
      </div>
    </div>
  );
}

/** The right-hand panel for a company's own FMS process. */
export function FmsInfo({ flow }: { flow: FlowListItem }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3">
      <h3 className="text-base font-semibold">{flow.name}</h3>
      <p className="text-sm text-muted-foreground">
        <span className="font-mono">{flow.code}</span> · {t('flows.steps', { count: flow.steps })} · v
        {flow.version}
      </p>
      <p className="text-sm text-muted-foreground">{t('flows.fmsHint')}</p>
      <Button asChild size="sm">
        <Link to={`/fms/builder/${flow.id}`}>
          {t('flows.editFlow')} <ArrowRight />
        </Link>
      </Button>
    </div>
  );
}

/** Beside the system map: every process by area, one tap to open it (easier than the chart on a phone). */
export function MapIndex({ keys, onOpen }: { keys: string[]; onOpen: (key: string) => void }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t('flows.mapHint')}</p>
      {PROCESS_GROUPS.map((g) => {
        const list = PROCESSES.filter((p) => p.group === g && keys.includes(p.key));
        if (!list.length) return null;
        return (
          <section key={g} className="space-y-1">
            <h4 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              {t(`flows.group.${g}`)}
            </h4>
            <ul className="flex flex-wrap gap-1.5">
              {list.map((p) => (
                <li key={p.key}>
                  <button
                    type="button"
                    onClick={() => onOpen(p.key)}
                    className="rounded-pill border bg-card px-3 py-1.5 text-sm hover:border-primary/60 hover:bg-muted"
                  >
                    {t(`flows.p.${p.key}`)}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
