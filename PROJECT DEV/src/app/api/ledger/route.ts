import { NextResponse } from 'next/server';
import { getLedgerEntries } from '@/server/db';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limitParam = url.searchParams.get('limit');
  const offsetParam = url.searchParams.get('offset');
  const chainParam = url.searchParams.get('chain') || 'all';
  const sortParam = (url.searchParams.get('sort') || 'newest') as 'newest' | 'multi';

  const limit = Math.min(100, Math.max(1, limitParam ? parseInt(limitParam, 10) : 12));
  const offset = Math.max(0, offsetParam ? parseInt(offsetParam, 10) : 0);

  const { entries, total, has_more } = await getLedgerEntries({
    chain: chainParam,
    sort: sortParam,
    limit,
    offset,
  });

  return NextResponse.json(
    { entries, total, has_more },
    {
      status: 200,
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=30',
      },
    }
  );
}
