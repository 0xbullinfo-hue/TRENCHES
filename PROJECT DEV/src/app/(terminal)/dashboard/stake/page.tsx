import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE_NAME, verifySessionToken } from '@/server/auth';
import { StakeClientView } from '@/components/stake/StakeClientView';
import { getStakeStatusForWallet } from '@/server/db';

export const dynamic = 'force-dynamic';

export default async function StakePage() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!sessionToken) {
    redirect('/dashboard');
  }

  const verified = verifySessionToken(sessionToken);
  if (!verified?.wallet) {
    redirect('/dashboard');
  }

  const initialData = await getStakeStatusForWallet(verified.wallet);
  return <StakeClientView initialData={initialData} />;
}
