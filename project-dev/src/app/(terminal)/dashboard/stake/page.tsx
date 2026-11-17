import { cookies } from 'next/headers';
import { SESSION_COOKIE_NAME, verifySessionToken } from '@/server/auth';
import { StakeClientView } from '@/components/stake/StakeClientView';
import { getStakeStatusForWallet } from '@/server/db';

export const dynamic = 'force-dynamic';

const EMPTY_STAKE_DATA = {
  wallet: '',
  current_tier: 'unknown' as const,
  stake: {
    amount_raw: '0',
    amount_genesis: 0,
    amount_usd: 0,
    staked_at: null,
    unlocks_at: null,
    days_remaining: 0,
    status: 'none' as const,
  },
  thresholds: {
    pro: {
      genesis_usd_price: 0.0000164,
      token_amount: '0',
    },
    stale: true,
  },
  eligible_for_pro: false,
  gap_to_pro_usd: 250,
};

export default async function StakePage() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const verified = sessionToken ? verifySessionToken(sessionToken) : null;

  // Do not redirect unauthenticated visitors to Overview: render the staking
  // shell so a connected wallet can authenticate from the client and load status.
  const initialData = verified?.wallet
    ? await getStakeStatusForWallet(verified.wallet)
    : EMPTY_STAKE_DATA;

  return <StakeClientView initialData={initialData} />;
}
