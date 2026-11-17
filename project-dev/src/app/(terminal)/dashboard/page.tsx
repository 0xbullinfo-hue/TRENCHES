'use client';

import React from 'react';
import { IncubatorHub } from '@/components/dashboard/IncubatorHub';

export default function DashboardPage() {
  return (
    <section id="terminal" className="flex-1 py-6 bg-canvas">
      <div className="max-w-[1360px] mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
        {/* Sidebar-driven terminal workspaces + Overview account landing page */}
        <IncubatorHub />
      </div>
    </section>
  );
}
