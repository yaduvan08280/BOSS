import { describe, expect, it } from 'vitest';
import { PACK_LIBRARY } from './index';

/** Found while setting up a restaurant (14/11/2026): pack roles could not see their process steps, punch or ask leave. */
describe('pack roles', () => {
  const baseline = [
    'fms.view',
    'fms.create',
    'hr.view',
    'hr.create',
    'checklist.create',
    'search.view',
    'org.view',
  ];
  it('every role of every library pack has what the built-in Member has for daily work', () => {
    const missing = PACK_LIBRARY.flatMap((pack) =>
      (pack.roles ?? []).flatMap((role) =>
        baseline.filter((r) => !role.permissions.includes(r)).map((r) => `${pack.key}/${role.key}: ${r}`),
      ),
    );
    expect(missing).toEqual([]);
  });
});
