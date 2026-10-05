'use client';

import { deviceKey, fingerprintSync, getFingerprint } from './device';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
  /** First field-level validation issue, if any. */
  fieldErrors(): Record<string, string> {
    const issues = (this.details as { issues?: Array<{ path: string; message: string }> } | undefined)?.issues ?? [];
    const out: Record<string, string> = {};
    for (const i of issues) if (i.path && !out[i.path]) out[i.path] = i.message;
    return out;
  }
}

function headers(json: boolean): Record<string, string> {
  const h: Record<string, string> = { 'X-Requested-With': 'cashads' };
  if (json) h['Content-Type'] = 'application/json';
  const key = deviceKey();
  if (key) h['X-Device-Key'] = key;
  const fp = fingerprintSync();
  if (fp) h['X-Device-Fp'] = fp;
  return h;
}

/** All browser traffic goes to /api on this same origin (proxied to the API service). */
export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const method = opts.method ?? (opts.body !== undefined ? 'POST' : 'GET');
  if (method !== 'GET') await getFingerprint();
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'include',
      cache: 'no-store',
      headers: headers(opts.body !== undefined),
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError(0, 'network', 'You appear to be offline. Check your connection and try again.');
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const e = (data as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
    throw new ApiError(res.status, e?.code ?? 'error', e?.message ?? 'Something went wrong — please try again.', e?.details);
  }
  return data as T;
}

export async function uploadImage(file: File, purpose: 'claim_evidence' | 'kyc_document' | 'kyc_selfie' | 'ticket'): Promise<{ id: string }> {
  if (file.size > 5 * 1024 * 1024) throw new ApiError(413, 'file_too_large', 'Images must be under 5 MB');
  const form = new FormData();
  form.append('purpose', purpose);
  form.append('file', file);
  const h = headers(false);
  const res = await fetch('/api/uploads', { method: 'POST', credentials: 'include', headers: h, body: form });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error?.code ?? 'upload_failed', data?.error?.message ?? 'Upload failed');
  return data;
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Something went wrong';
}
