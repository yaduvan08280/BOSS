import { AppError } from '../../../lib/errors';
import type { SourceHandler } from './index';

/** `fms:<flowId>:<field>` — the distinct values typed in that field across that flow's records. */
export const fmsValueSource: SourceHandler = async () => {
  throw new AppError(400, 'VALIDATION_FAILED', 'Unknown master');
};
