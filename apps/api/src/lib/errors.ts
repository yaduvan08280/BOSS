import type { ErrorCode } from '@mono/shared';

/** Throw this for any user-facing error; the error plugin turns it into `{ error: { code, message, details } }`. */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const unauthenticated = (message = 'Please sign in') => new AppError(401, 'UNAUTHENTICATED', message);
export const forbidden = (message = "You don't have access to this") =>
  new AppError(403, 'FORBIDDEN', message);
export const notFound = (what = 'Record') => new AppError(404, 'NOT_FOUND', `${what} not found`);
export const badRequest = (message: string, details?: unknown) =>
  new AppError(400, 'BAD_REQUEST', message, details);
