export function NextStepCardSkeleton() {
  const s = 'animate-pulse rounded bg-surface-card';
  return (
    <div className="rounded-lg border border-line bg-surface-card p-4" aria-hidden="true">
      <div className={`${s} h-5 w-2/3`} />
      <div className={`${s} mt-2 h-4 w-full`} />
      <div className={`${s} mt-4 h-4 w-1/2`} />
      <div className={`${s} mt-2 h-4 w-1/2`} />
      <div className={`${s} mt-4 h-9 w-32`} />
    </div>
  );
}
