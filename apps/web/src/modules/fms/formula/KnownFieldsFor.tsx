import { useMemo, type ReactNode } from 'react';
import { knownFieldsFor, type FlowDefinition } from '@mono/shared';
import { KnownFields } from './known';

/** Around a step's editor: its formulas may read the start form and the steps that can come before it. */
export function KnownFieldsFor({
  def,
  stepKey,
  children,
}: {
  def: FlowDefinition;
  stepKey: string;
  children: ReactNode;
}) {
  const known = useMemo(() => knownFieldsFor(def, stepKey), [def, stepKey]);
  return <KnownFields value={known}>{children}</KnownFields>;
}
