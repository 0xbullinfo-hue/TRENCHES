import React from 'react';
import { Skeleton } from '@/components/ui/Skeleton';

export function LedgerTableSkeleton({ rowCount = 6 }: { rowCount?: number }) {
  return (
    <div className="w-full overflow-x-auto rounded-xl border border-border-default bg-surface-card shadow-none">
      <table className="w-full min-w-[680px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border-default/60 bg-surface/70">
            <th scope="col" className="px-4 py-3 text-left">
              <Skeleton className="h-3.5 w-16" />
            </th>
            <th scope="col" className="px-4 py-3 text-right">
              <Skeleton className="h-3.5 w-20 ml-auto" />
            </th>
            <th scope="col" className="px-4 py-3 text-right">
              <Skeleton className="h-3.5 w-20 ml-auto" />
            </th>
            <th scope="col" className="px-4 py-3 text-right">
              <Skeleton className="h-3.5 w-16 ml-auto" />
            </th>
            <th scope="col" className="px-4 py-3 text-right">
              <Skeleton className="h-3.5 w-14 ml-auto" />
            </th>
            <th scope="col" className="px-4 py-3 text-right">
              <Skeleton className="h-3.5 w-20 ml-auto" />
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border-default/30">
          {Array.from({ length: rowCount }).map((_, i) => (
            <tr key={i} className="h-12 border-b border-border-default/20">
              <td className="px-4 py-3.5">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-3.5 w-10" />
                </div>
              </td>
              <td className="px-4 py-3.5 text-right">
                <Skeleton className="h-4 w-16 ml-auto" />
              </td>
              <td className="px-4 py-3.5 text-right">
                <Skeleton className="h-4 w-16 ml-auto" />
              </td>
              <td className="px-4 py-3.5 text-right">
                <Skeleton className="h-4 w-12 ml-auto" />
              </td>
              <td className="px-4 py-3.5 text-right">
                <Skeleton className="h-4 w-14 ml-auto" />
              </td>
              <td className="px-4 py-3.5 text-right">
                <Skeleton className="h-6 w-14 ml-auto" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const LedgerCardSkeleton = LedgerTableSkeleton;
