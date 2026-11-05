import { NextResponse } from 'next/server';
import { getAuthSession } from '@/server/auth';
import { isAdminWallet } from '@/lib/config';
import { createLedgerEntry, getLedgerEntries } from '@/server/db';
import { validateContractAddress, validateMultiplier } from '@/lib/ledger/format';

export async function GET(req: Request) {
  const session = await getAuthSession(req);
  if (!session || !isAdminWallet(session.wallet)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const { entries, total } = await getLedgerEntries({ limit: 1000, offset: 0, sort: 'newest' });
  return NextResponse.json({ ok: true, entries, total });
}

export async function POST(req: Request) {
  const session = await getAuthSession(req);
  if (!session || !isAdminWallet(session.wallet)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad_request', message: 'Invalid JSON body' }, { status: 400 });
  }

  const rawTicker = typeof body.ticker === 'string' ? body.ticker.trim() : '';
  const ticker = rawTicker.toUpperCase().replace(/^\$/, '');
  if (!ticker || ticker.length > 20) {
    return NextResponse.json(
      { error: 'validation_error', message: 'Ticker is required and must be at most 20 characters' },
      { status: 400 }
    );
  }

  const rawChain = typeof body.chain === 'string' ? body.chain.trim().toLowerCase() : '';
  const validChains = ['solana', 'ethereum', 'base', 'bsc', 'other'];
  if (!rawChain || !validChains.includes(rawChain)) {
    return NextResponse.json(
      { error: 'validation_error', message: `Chain must be one of: ${validChains.join(', ')}` },
      { status: 400 }
    );
  }

  const contractAddress = typeof body.contract_address === 'string' ? body.contract_address.trim() : '';
  const caValidation = validateContractAddress(rawChain, contractAddress);
  if (!caValidation.valid) {
    return NextResponse.json(
      { error: 'validation_error', message: caValidation.error || 'Invalid contract address' },
      { status: 400 }
    );
  }

  const multValidation = validateMultiplier(body.multiplier as string | number);
  if (!multValidation.valid || multValidation.value === undefined) {
    return NextResponse.json(
      { error: 'validation_error', message: multValidation.error || 'Invalid multiplier' },
      { status: 400 }
    );
  }

  const closedAtRaw = typeof body.closed_at === 'string' ? body.closed_at.trim() : '';
  const closedAtDate = closedAtRaw ? new Date(closedAtRaw) : new Date();
  if (isNaN(closedAtDate.getTime())) {
    return NextResponse.json(
      { error: 'validation_error', message: 'Invalid closed_at date format' },
      { status: 400 }
    );
  }

  const entryPrice = typeof body.entry_price === 'string' ? body.entry_price.trim() : null;
  const exitPrice = typeof body.exit_price === 'string' ? body.exit_price.trim() : null;

  let proofUrl: string | null = null;
  if (typeof body.proof_url === 'string' && body.proof_url.trim()) {
    const p = body.proof_url.trim();
    if (!/^https?:\/\//i.test(p)) {
      return NextResponse.json(
        { error: 'validation_error', message: 'Proof URL must be a valid http(s) URL' },
        { status: 400 }
      );
    }
    proofUrl = p;
  }

  let notes: string | null = null;
  if (typeof body.notes === 'string' && body.notes.trim()) {
    const n = body.notes.trim();
    if (n.length > 280) {
      return NextResponse.json(
        { error: 'validation_error', message: 'Notes must be at most 280 characters' },
        { status: 400 }
      );
    }
    notes = n;
  }

  try {
    const entry = await createLedgerEntry({
      ticker,
      chain: rawChain,
      contract_address: contractAddress,
      multiplier: multValidation.value.toString(),
      entry_price: entryPrice,
      exit_price: exitPrice,
      proof_url: proofUrl,
      notes,
      closed_at: closedAtDate.toISOString(),
      posted_by: session.wallet,
    });

    return NextResponse.json({ ok: true, id: entry.id }, { status: 201 });
  } catch (err) {
    console.error('[TrenchLabs Admin Ledger] Error creating entry:', err);
    return NextResponse.json({ error: 'internal_error', message: 'Failed to create ledger entry' }, { status: 500 });
  }
}
