import { NextResponse } from 'next/server';
import { getGenesisPrice } from '@/server/price';
import { MEMBER_USD_THRESHOLD, PRO_STAKE_USD_THRESHOLD, PRO_STAKE_MIN_LOCK_DAYS } from '@/server/entitlements';
import { TOKEN_DECIMALS, TOKEN_SYMBOL } from '@/lib/config';

export const dynamic = 'force-dynamic';

function computeRawAmount(usdTarget: number, priceUsd: number): string {
  if (priceUsd <= 0) return '0';
  const tokens = usdTarget / priceUsd;
  const rawBigInt = BigInt(Math.floor(tokens * Math.pow(10, TOKEN_DECIMALS)));
  return rawBigInt.toString();
}

export async function GET() {
  try {
    const priceResult = await getGenesisPrice();
    const priceUsd = priceResult.priceUsd;
    const now = new Date();
    const validUntil = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const memberRaw = computeRawAmount(MEMBER_USD_THRESHOLD, priceUsd);
    const proRaw = computeRawAmount(PRO_STAKE_USD_THRESHOLD, priceUsd);

    const responseData = {
      member: {
        usd_target: MEMBER_USD_THRESHOLD,
        token_amount: memberRaw,
        token_symbol: TOKEN_SYMBOL,
        token_decimals: TOKEN_DECIMALS,
        genesis_usd_price: priceUsd,
        valid_until: validUntil,
      },
      pro: {
        usd_target: PRO_STAKE_USD_THRESHOLD,
        token_amount: proRaw,
        token_symbol: TOKEN_SYMBOL,
        token_decimals: TOKEN_DECIMALS,
        genesis_usd_price: priceUsd,
        lock_days: PRO_STAKE_MIN_LOCK_DAYS,
        valid_until: validUntil,
      },
      price_source: priceResult.source,
      is_fresh: priceResult.isFresh,
      recalculated_at: priceResult.timestamp,
      stale: !priceResult.isFresh,
    };

    return NextResponse.json(responseData, {
      status: 200,
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
      },
    });
  } catch (err) {
    console.error('[TrenchLabs API] /api/tiers/current error:', err);
    return NextResponse.json(
      {
        member: {
          usd_target: 20,
          token_amount: '1219512195121951',
          token_symbol: TOKEN_SYMBOL,
          token_decimals: TOKEN_DECIMALS,
          genesis_usd_price: 0.0000164,
          valid_until: new Date(Date.now() + 7 * 86400000).toISOString(),
        },
        pro: {
          usd_target: 250,
          token_amount: '15243902439024390',
          token_symbol: TOKEN_SYMBOL,
          token_decimals: TOKEN_DECIMALS,
          genesis_usd_price: 0.0000164,
          lock_days: 90,
          valid_until: new Date(Date.now() + 7 * 86400000).toISOString(),
        },
        price_source: 'fallback',
        is_fresh: false,
        recalculated_at: new Date().toISOString(),
        stale: true,
      },
      {
        status: 200,
        headers: {
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
        },
      }
    );
  }
}
