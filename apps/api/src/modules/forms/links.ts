import type { FormStage } from './index';

/** Linked choices (§2.2–2.3): what was picked from a master, another flow or a record — the link is checked and kept, auto-fill and locked fields are settled on the server. */
export const linkStage: FormStage = { name: 'links' };
