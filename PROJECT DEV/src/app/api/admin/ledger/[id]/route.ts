import { NextResponse } from 'next/server';
import { getAuthSession } from '@/server/auth';
import { isAdminWallet } from '@/lib/config';
import { deleteLedgerEntry, getLedgerEntryById, updateLedgerEntry } from '@/server/db';
import { validateContractAddress, validateMultiplier } from '@/lib/ledger/format';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAuthSession(req);
  if (!session || !isAdminWallet(session.wallet)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const { id } = await params;
  const entry = await getLedgerEntryById(id);
  if (!entry) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  return NextResponse.json({ ok: true, entry });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAuthSession(req);
  if (!session || !isAdminWallet(session.wallet)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const { id } = await params;
  const existing = await getLedgerEntryById(id);
  if (!existing) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad_request', message: 'Invalid JSON body' }, { status: 400 });
  }

  const updates: Parameters<typeof updateLedgerEntry>[1] = {};

  if (body.ticker !== undefined) {
    const rawTicker = typeof body.ticker === 'string' ? body.ticker.trim() : '';
    const ticker = rawTicker.toUpperCase().replace(/^\$/, '');
    if (!ticker || ticker.length > 20) {
      return NextResponse.json(
        { error: 'validation_error', message: 'Ticker must be 1 to 20 characters' },
        { status: 400 }
      );
    }
    updates.ticker = ticker;
  }

  let targetChain = existing.chain;
  if (body.chain !== undefined) {
    const rawChain = typeof body.chain === 'string' ? body.chain.trim().toLowerCase() : '';
    const validChains = ['solana', 'ethereum', 'base', 'bsc', 'other'];
    if (!rawChain || !validChains.includes(rawChain)) {
      return NextResponse.json(
        { error: 'validation_error', message: `Chain must be one of: ${validChains.join(', ')}` },
        { status: 400 }
      );
    }
    updates.chain = rawChain;
    targetChain = rawChain;
  }

  if (body.contract_address !== undefined) {
    const ca = typeof body.contract_address === 'string' ? body.contract_address.trim() : '';
    const caVal = validateContractAddress(targetChain, ca);
    if (!caVal.valid) {
      return NextResponse.json(
        { error: 'validation_error', message: caVal.error || 'Invalid contract address' },
        { status: 400 }
      );
    }
    updates.contract_address = ca;
  }

  if (body.multiplier !== undefined) {
    const multVal = validateMultiplier(body.multiplier as string | number);
    if (!multVal.valid || multVal.value === undefined) {
      return NextResponse.json(
        { error: 'validation_error', message: multVal.error || 'Invalid multiplier' },
        { status: 400 }
      );
    }
    updates.multiplier = multVal.value.toString();
  }

  if (body.closed_at !== undefined) {
    const closedDate = new Date(body.closed_at as string);
    if (isNaN(closedDate.getTime())) {
      return NextResponse.json(
        { error: 'validation_error', message: 'Invalid closed_at date format' },
        { status: 400 }
      );
    }
    updates.closed_at = closedDate.toISOString();
  }

  if (body.entry_price !== undefined) {
    updates.entry_price = typeof body.entry_price === 'string' ? body.entry_price.trim() : null;
  }

  if (body.exit_price !== undefined) {
    updates.exit_price = typeof body.exit_price === 'string' ? body.exit_price.trim() : null;
  }

  if (body.proof_url !== undefined) {
    if (typeof body.proof_url === 'string' && body.proof_url.trim()) {
      const p = body.proof_url.trim();
      if (!/^https?:\/\//i.test(p)) {
        return NextResponse.json(
          { error: 'validation_error', message: 'Proof URL must be a valid http(s) URL' },
          { status: 400 }
        );
      }
      updates.proof_url = p;
    } else {
      updates.proof_url = null;
    }
  }

  if (body.notes !== undefined) {
    if (typeof body.notes === 'string' && body.notes.trim()) {
      const n = body.notes.trim();
      if (n.length > 280) {
        return NextResponse.json(
          { error: 'validation_error', message: 'Notes must be at most 280 characters' },
          { status: 400 }
        );
      }
      updates.notes = n;
    } else {
      updates.notes = null;
    }
  }

  const updated = await updateLedgerEntry(id, updates);
  return NextResponse.json({ ok: true, entry: updated });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAuthSession(req);
  if (!session || !isAdminWallet(session.wallet)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const { id } = await params;
  const ok = await deleteLedgerEntry(id);
  if (!ok) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}

