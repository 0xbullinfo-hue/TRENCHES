import { NextRequest, NextResponse } from 'next/server';
import { ImageResponse } from 'next/og';
import { clientIp, rateLimit } from '@/server/ratelimit';

export const runtime = 'nodejs';

function cleanParam(val: string | null, fallback: string, maxLen: number): string {
  const trimmed = (val ?? '').trim();
  if (!trimmed) return fallback;
  return trimmed.replace(/[\r\n<>]/g, '').slice(0, maxLen) || fallback;
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const rl = await rateLimit(`share-image:ip:${clientIp(req)}`, 60, 60);
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'rate_limited', message: 'Too many requests', retryAfter: rl.retryAfter },
      { status: 429, headers: { 'Cache-Control': 'no-store', 'Retry-After': String(rl.retryAfter) } }
    );
  }

  const { id } = await context.params;
  const search = req.nextUrl.searchParams;
  const ticker = cleanParam(search.get('ticker'), 'H42', 16).replace(/^\$+/, '');
  const chain = cleanParam(search.get('chain'), 'SOL', 16).toUpperCase();
  const multiplier = cleanParam(search.get('multiplier'), '—', 16);
  const entry = cleanParam(search.get('entry'), '—', 24);
  const callId = cleanParam(id, 'signal', 24);

  return new ImageResponse(
    (
      <div
        style={{
          width: '1200px',
          height: '630px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          backgroundColor: '#0A0E13',
          color: '#F8FAFC',
          padding: '56px 64px',
          fontFamily: 'sans-serif',
          border: '2px solid #252D38',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div
              style={{
                width: '44px',
                height: '44px',
                borderRadius: '10px',
                backgroundColor: '#0D281E',
                border: '2px solid #34D399',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#34D399',
                fontSize: '22px',
                fontWeight: 800,
              }}
            >
              TL
            </div>
            <span style={{ fontSize: '28px', fontWeight: 800, letterSpacing: '-0.02em' }}>
              TrenchLabsHQ
            </span>
          </div>

          <div
            style={{
              display: 'flex',
              padding: '8px 18px',
              borderRadius: '9999px',
              backgroundColor: '#161C24',
              border: '1px solid #252D38',
              color: '#9AA3B2',
              fontSize: '20px',
              fontWeight: 700,
            }}
          >
            {chain} • VERIFIED CALL
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
          <div style={{ display: 'flex', fontSize: '24px', color: '#9AA3B2', fontWeight: 600 }}>
            Token Signal #{callId}
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              gap: '32px',
            }}
          >
            <span style={{ fontSize: '84px', fontWeight: 900, letterSpacing: '-0.03em' }}>
              ${ticker}
            </span>
            <span style={{ fontSize: '76px', fontWeight: 900, color: '#34D399' }}>
              {multiplier.includes('x') || multiplier === '—' ? multiplier : `${multiplier}x`}
            </span>
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderTop: '1px solid #252D38',
            paddingTop: '24px',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={{ fontSize: '18px', color: '#9AA3B2' }}>Entry Market Cap</span>
            <span style={{ fontSize: '28px', fontWeight: 700, color: '#F8FAFC' }}>{entry}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
            <span style={{ fontSize: '18px', color: '#9AA3B2' }}>Powered by $H42</span>
            <span style={{ fontSize: '24px', fontWeight: 700, color: '#34D399' }}>
              trenchlabshq.xyz
            </span>
          </div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      headers: {
        'Cache-Control': 'public, max-age=3600, s-maxage=86400',
      },
    }
  );
}
