import React from 'react';
import { HeroTerminal } from '@/components/HeroTerminal';
import { PipelineGrid } from '@/components/PipelineGrid';
import { TierSection } from '@/components/landing/TierSection';

export default function LandingPage() {
  return (
    <div className="flex flex-col bg-canvas">
      {/* 1. Hero Section */}
      <HeroTerminal />

      {/* 2. Incubator Pipeline Section (Past Early-Access Tokens & X Profits Earned) */}
      <PipelineGrid />

      {/* 3. Access Tiers (replaces legacy Join the Lab card) */}
      <TierSection />
    </div>
  );
}

