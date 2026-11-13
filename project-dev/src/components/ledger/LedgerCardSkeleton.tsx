import React from 'react';

export function LedgerTableSkeleton({ rowCount = 6 }: { rowCount?: number }) {
  return (
    <div className="w-full overflow-x-auto rounded-xl border border-border-default bg-surface-card animate-pulse shadow-none">
      <table className="w-full min-w-[680px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border-default/60 bg-surface/70">
            <th scope="col" className="px-4 py-3 text-left">
              <div className="h-3.5 w-16 bg-surface rounded" />
            </th>
            <th scope="col" className="px-4 py-3 text-right">
              <div className="h-3.5 w-20 bg-surface rounded ml-auto" />
            </th>
            <th scope="col" className="px-4 py-3 text-right">
              <div className="h-3.5 w-20 bg-surface rounded ml-auto" />
            </th>
            <th scope="col" className="px-4 py-3 text-right">
              <div className="h-3.5 w-16 bg-surface rounded ml-auto" />
            </th>
            <th scope="col" className="px-4 py-3 text-right">
              <div className="h-3.5 w-14 bg-surface rounded ml-auto" />
            </th>
            <th scope="col" className="px-4 py-3 text-right">
              <div className="h-3.5 w-20 bg-surface rounded ml-auto" />
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border-default/30">
          {Array.from({ length: rowCount }).map((_, i) => (
            <tr key={i} className="h-12 border-b border-border-default/20">
              <td className="px-4 py-3.5">
                <div className="flex items-center gap-2">
                  <div className="h-4 w-16 bg-surface rounded" />
                  <div className="h-3.5 w-10 bg-surface rounded" />
                </div>
              </td>
              <td className="px-4 py-3.5 text-right">
                <div className="h-4 w-16 bg-surface rounded ml-auto" />
              </td>
              <td className="px-4 py-3.5 text-right">
                <div className="h-4 w-16 bg-surface rounded ml-auto" />
              </td>
              <td className="px-4 py-3.5 text-right">
                <div className="h-4 w-12 bg-surface rounded ml-auto" />
              </td>
              <td className="px-4 py-3.5 text-right">
                <div className="h-4 w-14 bg-surface rounded ml-auto" />
              </td>
              <td className="px-4 py-3.5 text-right">
                <div className="h-6 w-14 bg-surface rounded ml-auto" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const LedgerCardSkeleton = LedgerTableSkeleton;
