import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/server/auth';
import { getStakeStatusForWallet } from '@/server/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = await getAuthSession(req);
  if (!session) {
    return NextResponse.json({ error: 'unauthorized', message: 'Session required' }, { status: 401 });
  }

  const data = await getStakeStatusForWallet(session.wallet);
  return NextResponse.json(data);
}

