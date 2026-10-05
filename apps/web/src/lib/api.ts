import { deviceFingerprint, deviceId } from './device';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields?: Record<string, string>,
    public details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

/**
 * Thin fetch wrapper. Browser code only uses relative `/api` URLs (the dev server /
 * production server routes them), sends the CSRF header on mutations, and turns
 * the API's stable error envelope into a typed ApiError.
 */
export async function api<T>(
  path: string,
  opts: { method?: Method; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const method = opts.method ?? (opts.body === undefined ? 'GET' : 'POST');
  const headers: Record<string, string> = { 'x-device-id': deviceId() };
  const fp = deviceFingerprint();
  if (fp) headers['x-device-fp'] = fp;
  if (method !== 'GET') headers['x-requested-with'] = 'lucrum';
  const isForm = typeof FormData !== 'undefined' && opts.body instanceof FormData;
  if (opts.body !== undefined && !isForm) headers['content-type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers,
      credentials: 'same-origin',
      signal: opts.signal,
      body:
        opts.body === undefined ? undefined : isForm ? (opts.body as FormData) : JSON.stringify(opts.body),
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError(
      0,
      'NETWORK',
      'You appear to be offline. Your balance is safe — try again when you’re connected.',
    );
  }
  if (!res.ok) {
    const json = (await res.json().catch(() => null)) as {
      error?: {
        code?: string;
        message?: string;
        fields?: Record<string, string>;
        details?: Record<string, unknown>;
      };
    } | null;
    throw new ApiError(
      res.status,
      json?.error?.code ?? `HTTP_${res.status}`,
      json?.error?.message ?? 'Something went wrong. Please try again.',
      json?.error?.fields,
      json?.error?.details,
    );
  }
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get('content-type') ?? '';
  return (ct.includes('application/json') ? res.json() : res.text()) as Promise<T>;
}

export const get = <T>(path: string) => api<T>(path);
export const post = <T>(path: string, body: unknown = undefined) => api<T>(path, { method: 'POST', body });
export const patch = <T>(path: string, body: unknown) => api<T>(path, { method: 'PATCH', body });
export const put = <T>(path: string, body: unknown) => api<T>(path, { method: 'PUT', body });
export const del = <T>(path: string) => api<T>(path, { method: 'DELETE' });

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Something went wrong';
}
