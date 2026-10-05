export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (message: string, code = 'bad_request', details?: unknown) => new AppError(400, code, message, details);
export const unauthorized = (message = 'Please log in to continue', code = 'unauthorized') => new AppError(401, code, message);
export const forbidden = (message = 'You do not have access to this', code = 'forbidden', details?: unknown) => new AppError(403, code, message, details);
export const notFound = (message = 'Not found', code = 'not_found') => new AppError(404, code, message);
export const conflict = (message: string, code = 'conflict', details?: unknown) => new AppError(409, code, message, details);
export const tooMany = (message = 'Too many requests — please slow down', code = 'rate_limited') => new AppError(429, code, message);

export function assert(condition: unknown, error: AppError): asserts condition {
  if (!condition) throw error;
}
