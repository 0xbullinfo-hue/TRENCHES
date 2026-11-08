import { NextRequest, NextResponse } from 'next/server';
import { markSubmissionStatus } from '@/server/campaigns-data';
import { getAuthSession, verifyAdminAuth } from '@/server/auth';
import { isAdminWallet } from '@/lib/config';
import type { SubmissionStatus } from '@/lib/types';

export const dynamic = 'force-dynamic';
const NO_STORE = { 'Cache-Control': 'no-store' };

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ submissionId: string }> }
) {
  const { submissionId } = await params;
  const rawBody = await req.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid JSON body' },
      { status: 400, headers: NO_STORE }
    );
  }

  // Admin auth
  const adminAuth = await verifyAdminAuth(req, rawBody);
  if (!adminAuth.authorized) {
    const session = await getAuthSession(req);
    if (!session || !isAdminWallet(session.wallet)) {
      return NextResponse.json(
        { ok: false, error: adminAuth.error || 'Unauthorized: Admin access required.' },
        { status: 401, headers: NO_STORE }
      );
    }
  }

  const rawStatus = typeof body.status === 'string' ? body.status.toUpperCase() : '';
  if (rawStatus !== 'AIRDROPPED' && rawStatus !== 'PENDING' && rawStatus !== 'REJECTED') {
    return NextResponse.json(
      { ok: false, error: 'Status must be AIRDROPPED, PENDING, or REJECTED' },
      { status: 400, headers: NO_STORE }
    );
  }

  const airdropTx = typeof body.airdropTx === 'string' ? body.airdropTx.trim() : undefined;

  try {
    const result = await markSubmissionStatus(
      submissionId,
      rawStatus as SubmissionStatus,
      airdropTx
    );
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error || 'Failed to update submission' },
        { status: 404, headers: NO_STORE }
      );
    }
    return NextResponse.json({ ok: true, status: rawStatus }, { headers: NO_STORE });
  } catch (err) {
    console.error('[API /api/admin/campaigns/submissions/[submissionId] PATCH] Error:', err);
    return NextResponse.json(
      { ok: false, error: 'Failed to update submission' },
      { status: 500, headers: NO_STORE }
    );
  }
}

