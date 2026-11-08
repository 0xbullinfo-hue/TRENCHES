export interface TierCardProps {
  name: 'Free' | 'Member' | 'Pro';
  priceLabel: string;
  subtitle: string;
  thresholdLabel?: string;
  features: string[];
  ctaLabel: string;
  ctaHref: string;
  ctaDisabled?: boolean;
  ctaTooltip?: string;
  emphasized?: boolean;
  badge?: string;
}

