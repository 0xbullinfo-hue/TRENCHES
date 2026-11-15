'use client';

import React from 'react';
import { CheckCircle2, Circle, Loader2 } from 'lucide-react';
import { cn } from '@/components/ui/cn';

export type StakeTimelineStep =
  | 'idle'
  | 'submitted'
  | 'confirming'
  | 'verified'
  | 'active'
  | 'error';

export const STAKE_TIMELINE_STEPS: {
  id: Exclude<StakeTimelineStep, 'idle' | 'error'>;
  label: string;
  description: string;
}[] = [
  {
    id: 'submitted',
    label: 'Submitted',
    description: 'Signature received',
  },
  {
    id: 'confirming',
    label: 'Confirming',
    description: 'Checking Solana & StakePoint',
  },
  {
    id: 'verified',
    label: 'Verified',
    description: 'Lock parameters validated',
  },
  {
    id: 'active',
    label: 'Active',
    description: 'Pro entitlement live',
  },
];

const STEP_ORDER: Record<Exclude<StakeTimelineStep, 'idle' | 'error'>, number> = {
  submitted: 0,
  confirming: 1,
  verified: 2,
  active: 3,
};

/**
 * Duplicate-submission guard helper: returns true when a stake verification
 * workflow is currently in progress and the submit control must be disabled.
 */
export function isTimelineStepInProgress(step: StakeTimelineStep): boolean {
  return step === 'submitted' || step === 'confirming' || step === 'verified';
}

export function getStepVisualState(
  currentStep: StakeTimelineStep,
  targetStep: Exclude<StakeTimelineStep, 'idle' | 'error'>
): 'completed' | 'current' | 'upcoming' {
  if (currentStep === 'idle' || currentStep === 'error') {
    return 'upcoming';
  }
  if (currentStep === 'active') {
    return 'completed';
  }
  const currentIdx = STEP_ORDER[currentStep];
  const targetIdx = STEP_ORDER[targetStep];
  if (targetIdx < currentIdx) return 'completed';
  if (targetIdx === currentIdx) return 'current';
  return 'upcoming';
}

export interface StakeStatusTimelineProps {
  step: StakeTimelineStep;
  className?: string;
}

export const StakeStatusTimeline: React.FC<StakeStatusTimelineProps> = ({
  step,
  className,
}) => {
  return (
    <div
      data-testid="stake-status-timeline"
      data-step={step}
      role="status"
      aria-live="polite"
      aria-label="Stake transaction verification timeline"
      className={cn(
        'rounded-lg bg-surface-card border border-border-default p-3.5 sm:p-4 space-y-3',
        className
      )}
    >
      <div className="flex items-center justify-between gap-2 font-mono text-xs">
        <span className="font-bold text-white">Transaction status</span>
        <span className="text-muted">
          {step === 'idle'
            ? 'Awaiting signature'
            : step === 'active'
            ? 'Pro tier active'
            : step === 'error'
            ? 'Verification halted'
            : 'Processing on-chain...'}
        </span>
      </div>

      <ol className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {STAKE_TIMELINE_STEPS.map((item, idx) => {
          const state = getStepVisualState(step, item.id);
          return (
            <li
              key={item.id}
              data-testid={`stake-step-${item.id}`}
              data-state={state}
              className={cn(
                'p-2.5 rounded-lg border font-mono text-xs space-y-1 transition-colors',
                state === 'completed'
                  ? 'bg-brand-bg/20 border-brand/40 text-brand'
                  : state === 'current'
                  ? 'bg-surface border-brand text-white'
                  : 'bg-surface border-border-default text-muted'
              )}
            >
              <div className="flex items-center justify-between gap-1.5">
                <span className="font-bold">
                  {idx + 1}. {item.label}
                </span>
                {state === 'completed' ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-brand shrink-0" aria-hidden="true" />
                ) : state === 'current' ? (
                  <Loader2 className="w-3.5 h-3.5 text-brand animate-spin shrink-0" aria-hidden="true" />
                ) : (
                  <Circle className="w-3.5 h-3.5 text-muted shrink-0" aria-hidden="true" />
                )}
              </div>
              <div className="font-sans text-[11px] text-muted truncate">
                {item.description}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
};
