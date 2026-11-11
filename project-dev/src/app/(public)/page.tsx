import React from 'react';
import { HeroTerminal } from '@/components/HeroTerminal';
import { HowItWorksSection } from '@/components/landing/HowItWorksSection';
import { PipelineGrid } from '@/components/PipelineGrid';
import { AlphaIntelligencePreview } from '@/components/landing/AlphaIntelligencePreview';
import { TierSection } from '@/components/landing/TierSection';
import { PerformanceTrustSection } from '@/components/landing/PerformanceTrustSection';
import { CommunitySection } from '@/components/landing/CommunitySection';

export default function LandingPage() {
  return (
    <div className="flex flex-col bg-canvas">
      {/* 1. Hero Section & Trust Metrics */}
      <HeroTerminal />

      {/* 2. How The Lab Works (4-Stage Process) */}
      <HowItWorksSection />

      {/* 3. Incubator Pipeline (Historical Past Incubations & Multiples) */}
      <PipelineGrid />

      {/* 4. Alpha Intelligence Preview (Anatomy of a Trade Call) */}
      <AlphaIntelligencePreview />

      {/* 5. Access Tiers & Feature Matrix */}
      <TierSection />

      {/* 6. Performance & Trust (Verified Ledger Statistics & Disclosures) */}
      <PerformanceTrustSection />

      {/* 7. Community Conversion (Build with the Lab) */}
      <CommunitySection />
    </div>
  );
}
