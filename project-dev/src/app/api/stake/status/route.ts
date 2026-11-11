import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/server/auth';
import { getStakeStatusForWallet } from '@/server/db';
import { isBase58Address } from '@/lib/config';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const queryWallet = req.nextUrl.searchParams.get('wallet')?.trim();
  const session = await getAuthSession(req);
  const targetWallet = (queryWallet && isBase58Address(queryWallet)) ? queryWallet : session?.wallet;

  if (!targetWallet || !isBase58Address(targetWallet)) {
    return NextResponse.json({ error: 'unauthorized', message: 'Valid Solana wallet or session required' }, { status: 401 });
  }

  const data = await getStakeStatusForWallet(targetWallet);
  return NextResponse.json(data);
}

