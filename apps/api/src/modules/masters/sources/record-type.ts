import { AppError } from '../../../lib/errors';
import type { SourceHandler } from './index';

/** `rt:<recordTypeId>` — pick a record of a custom record type. */
export const recordTypeSource: SourceHandler = async () => {
  throw new AppError(400, 'VALIDATION_FAILED', 'Unknown master');
};
