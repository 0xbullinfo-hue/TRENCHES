import { NextResponse } from 'next/server';
import {
  getTierThresholds,
  TOKEN_DECIMALS,
  TOKEN_SYMBOL,
} from '@/server/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const { member, pro, stale } = await getTierThresholds();

    const responseData = {
      member: {
        usd_target: member.usd_target,
        token_amount: member.token_amount,
        token_symbol: TOKEN_SYMBOL,
        token_decimals: TOKEN_DECIMALS,
        genesis_usd_price: member.twap_price_usd,
        valid_until: member.valid_until,
      },
      pro: {
        usd_target: pro.usd_target,
        token_amount: pro.token_amount,
        token_symbol: TOKEN_SYMBOL,
        token_decimals: TOKEN_DECIMALS,
        genesis_usd_price: pro.twap_price_usd,
        lock_days: 90,
        valid_until: pro.valid_until,
      },
      twap_source: 'placeholder',
      recalculated_at: member.valid_from,
      stale,
    };

    return NextResponse.json(responseData, {
      status: 200,
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
      },
    });
  } catch (err) {
    console.error('[TrenchLabs API] /api/tiers/current error:', err);
    // Never 500 per §4
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
        twap_source: 'placeholder',
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
