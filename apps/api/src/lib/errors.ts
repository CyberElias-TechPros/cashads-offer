/** Typed application error → mapped to a stable JSON error body by the error handler. */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fields?: Record<string, string>,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (code: string, message: string, fields?: Record<string, string>) =>
  new AppError(400, code, message, fields);
export const unauthorized = (message = 'Please sign in to continue') =>
  new AppError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = 'You do not have access to this', code = 'FORBIDDEN') =>
  new AppError(403, code, message);
export const notFound = (what = 'Resource') => new AppError(404, 'NOT_FOUND', `${what} not found`);
export const conflict = (code: string, message: string, details?: Record<string, unknown>) =>
  new AppError(409, code, message, undefined, details);
export const tooMany = (message: string) => new AppError(429, 'RATE_LIMITED', message);

/** Postgres error helpers (works for node-postgres and PGlite). */
export function pgErrorCode(err: unknown): string | undefined {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code ?? e?.cause?.code;
}
export const isUniqueViolation = (err: unknown) => pgErrorCode(err) === '23505';
export const isCheckViolation = (err: unknown) => pgErrorCode(err) === '23514';
