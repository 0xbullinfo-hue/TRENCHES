import { NextRequest, NextResponse } from 'next/server';
import {
  deleteCampaign,
  getCampaignsWithUserStatus,
  updateCampaign,
} from '@/server/campaigns-data';
import { getAuthSession, verifyAdminAuth } from '@/server/auth';
import { isAdminWallet } from '@/lib/config';
import type { CampaignStatus } from '@/lib/types';

export const dynamic = 'force-dynamic';
const NO_STORE = { 'Cache-Control': 'no-store' };

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
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

  const updates: Record<string, unknown> = {};
  if (typeof body.status === 'string') {
    const s = body.status.toUpperCase();
    if (s === 'ACTIVE' || s === 'COMPLETED' || s === 'PAUSED') {
      updates.status = s as CampaignStatus;
    }
  }
  if (typeof body.title === 'string' && body.title.trim()) {
    updates.title = body.title.trim();
  }
  if (typeof body.description === 'string') {
    updates.description = body.description.trim();
  }
  if (typeof body.rewardAmount === 'string' && body.rewardAmount.trim()) {
    updates.rewardAmount = body.rewardAmount.trim();
  }
  if (typeof body.pinned === 'boolean') {
    updates.pinned = body.pinned;
  }

  try {
    const updated = await updateCampaign(id, updates);
    if (!updated) {
      return NextResponse.json(
        { ok: false, error: 'Campaign not found' },
        { status: 404, headers: NO_STORE }
      );
    }
    const all = await getCampaignsWithUserStatus();
    return NextResponse.json({ ok: true, campaign: updated, campaigns: all }, { headers: NO_STORE });
  } catch (err) {
    console.error('[API /api/campaigns/[id] PATCH] Error:', err);
    return NextResponse.json(
      { ok: false, error: 'Failed to update campaign' },
      { status: 500, headers: NO_STORE }
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const rawBody = await req.text().catch(() => '');

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

  try {
    const deleted = await deleteCampaign(id);
    if (!deleted) {
      return NextResponse.json(
        { ok: false, error: 'Campaign not found' },
        { status: 404, headers: NO_STORE }
      );
    }
    const all = await getCampaignsWithUserStatus();
    return NextResponse.json({ ok: true, deleted: true, campaigns: all }, { headers: NO_STORE });
  } catch (err) {
    console.error('[API /api/campaigns/[id] DELETE] Error:', err);
    return NextResponse.json(
      { ok: false, error: 'Failed to delete campaign' },
      { status: 500, headers: NO_STORE }
    );
  }
}

