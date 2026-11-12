import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { ApprovalsPanel } from './ApprovalsPanel';
import { RatesPanel } from './RatesPanel';
import { StructurePanel } from './StructurePanel';

const PARTS = ['structure', 'approvals', 'rates'] as const;

/** System Master → Branches (phase 12): the group's structure, and who approves what. */
export function BranchesTab() {
  const { t } = useTranslation();
  const [part, setPart] = useState<(typeof PARTS)[number]>('structure');
  return (
    <div className="space-y-5">
      <div role="tablist" className="inline-flex rounded-control bg-muted p-1">
        {PARTS.map((p) => (
          <button
            key={p}
            role="tab"
            aria-selected={part === p}
            onClick={() => setPart(p)}
            className={cn(
              'h-9 rounded-[calc(var(--radius)*0.5)] px-3 text-sm font-medium transition-colors',
              part === p
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t(`branches.part.${p}`)}
          </button>
        ))}
      </div>
      {part === 'structure' ? <StructurePanel /> : part === 'approvals' ? <ApprovalsPanel /> : <RatesPanel />}
    </div>
  );
}
