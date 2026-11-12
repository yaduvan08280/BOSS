import type { FormStage } from './index';

/** Unique values (§2.2): a value already used in another live record of the same owner is refused. */
export const uniqueStage: FormStage = { name: 'unique' };
