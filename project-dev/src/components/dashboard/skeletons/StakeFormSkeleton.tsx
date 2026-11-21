export function StakeFormSkeleton() {
  const s = 'animate-pulse rounded bg-surface-card';
  return (
    <div className="rounded-lg border border-line bg-surface-card p-4" aria-hidden="true">
      <div className={`${s} h-5 w-1/3`} />
      <div className={`${s} mt-2 h-4 w-2/3`} />
      <div className={`${s} mt-4 h-11 w-full`} />
      <div className={`${s} mt-2 h-4 w-1/2`} />
      <div className={`${s} mt-4 h-11 w-full`} />
      <div className={`${s} mt-3 h-11 w-full`} />
    </div>
  );
}
