import React from 'react';
import { DashboardNavigationProvider } from '@/components/dashboard/DashboardNavigationContext';
import { DashboardSidebar } from '@/components/dashboard/DashboardSidebar';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <DashboardNavigationProvider>
      <div className="flex flex-col md:flex-row min-h-[calc(100vh-5rem)] w-full bg-canvas">
        <DashboardSidebar />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </DashboardNavigationProvider>
  );
}
