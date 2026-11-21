type Props = { cols?: number; rows?: number };

export function SignalsGridSkeleton({ cols = 3, rows = 5 }: Props) {
  const s = 'animate-pulse rounded bg-surface-card';
  const total = Math.max(1, cols * rows);
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className="flex min-h-[140px] flex-col gap-3 rounded-lg border border-line bg-surface-card p-4"
        >
          <div className={`${s} h-5 w-2/3`} />
          <div className={`${s} h-10 w-full`} />
          <div className={`${s} h-4 w-1/2`} />
        </div>
      ))}
    </div>
  );
}
