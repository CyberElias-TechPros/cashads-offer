import type { WorkerRuntime } from './runtime';

export async function putObject(
  runtime: WorkerRuntime,
  key: string,
  body: ArrayBuffer | ReadableStream | string,
  contentType = 'application/octet-stream',
): Promise<void> {
  await runtime.storage.put(key, body, { httpMetadata: { contentType } });
}

export async function getObject(runtime: WorkerRuntime, key: string): Promise<R2ObjectBody | null> {
  return runtime.storage.get(key);
}

export async function deleteObject(runtime: WorkerRuntime, key: string): Promise<void> {
  await runtime.storage.delete(key);
}
