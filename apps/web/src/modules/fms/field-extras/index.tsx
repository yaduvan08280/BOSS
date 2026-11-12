import { FormulaExtras } from './FormulaExtras';
import { ItemsExtras } from './ItemsExtras';
import { LearnExtras } from './LearnExtras';
import { LinkExtras } from './LinkExtras';
import { ReportExtras } from './ReportExtras';
import type { ExtrasProps } from './types';

export type { ExtrasProps } from './types';

/** Everything a field can be set to do beyond label / type / required. Each block shows itself only when it applies. */
export function FieldExtras(p: ExtrasProps) {
  return (
    <>
      <LearnExtras {...p} />
      <LinkExtras {...p} />
      <FormulaExtras {...p} />
      <ItemsExtras {...p} />
      <ReportExtras {...p} />
    </>
  );
}
