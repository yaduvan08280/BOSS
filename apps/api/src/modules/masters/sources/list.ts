import { AppError } from '../../../lib/errors';
import type { SourceHandler } from './index';

/** `list:<key>` — the values of a "remember what people type" list, most used first. */
export const listSource: SourceHandler = async () => {
  throw new AppError(400, 'VALIDATION_FAILED', 'Unknown master');
};
