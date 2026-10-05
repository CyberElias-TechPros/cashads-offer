import { Skeleton } from './feedback';

/** Shown while auth pages that read the URL hydrate (keeps layout stable, no blank flash). */
export function AuthFallback() {
  return (
    <div className="space-y-5" aria-busy="true">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-11 w-full rounded-xl" />
      <Skeleton className="h-11 w-full rounded-xl" />
      <Skeleton className="h-11 w-full rounded-xl" />
    </div>
  );
}
