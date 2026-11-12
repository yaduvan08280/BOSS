import { AppError } from '../../../lib/errors';
import type { SourceHandler } from './index';

/** `rec:<flowId>` — pick a whole record of another flow ("#12 · Sharma wedding · 14/12/2026"). */
export const recordSource: SourceHandler = async () => {
  throw new AppError(400, 'VALIDATION_FAILED', 'Unknown master');
};
