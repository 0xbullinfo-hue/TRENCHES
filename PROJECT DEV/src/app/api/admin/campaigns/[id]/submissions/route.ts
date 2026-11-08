import { NextRequest, NextResponse } from 'next/server';
import { getSubmissionsForCampaign } from '@/server/campaigns-data';
import { getAuthSession, verifyAdminAuth } from '@/server/auth';
import { isAdminWallet } from '@/lib/config';

export const dynamic = 'force-dynamic';
const NO_STORE = { 'Cache-Control': 'no-store' };

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Admin auth
  const adminAuth = await verifyAdminAuth(req, '');
  if (!adminAuth.authorized) {
    const session = await getAuthSession(req);
    if (!session || !isAdminWallet(session.wallet)) {
      return NextResponse.json(
        { ok: false, error: adminAuth.error || 'Unauthorized: Admin access required.' },
        { status: 401, headers: NO_STORE }
      );
    }
  }

  try {
    const submissions = await getSubmissionsForCampaign(id);
    return NextResponse.json({ ok: true, submissions }, { headers: NO_STORE });
  } catch (err) {
    console.error('[API /api/admin/campaigns/[id]/submissions GET] Error:', err);
    return NextResponse.json(
      { ok: false, error: 'Failed to retrieve submissions' },
      { status: 500, headers: NO_STORE }
    );
  }
}

