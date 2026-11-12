import { NextRequest } from 'next/server';
import { POST as submitCampaign } from '../../src/app/api/campaigns/[id]/submit/route.ts';

const campaignId = process.argv[2];
const challengeId = process.argv[3];
const walletAddress = process.argv[4];
const signature = process.argv[5];
const xHandle = process.argv[6] || '@dist_raider';
const xRetweetLink = process.argv[7] || 'https://x.com/dist_raider/status/999';

async function main() {
  try {
    const req = new NextRequest(`http://localhost:3000/api/campaigns/${campaignId}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        challengeId,
        walletAddress,
        xHandle,
        xRetweetLink,
        signature,
      }),
    });

    const res = await submitCampaign(req, { params: Promise.resolve({ id: campaignId }) });
    let json = {};
    try {
      json = await res.json();
    } catch {}

    process.stdout.write(JSON.stringify({
      ok: true,
      status: res.status,
      data: json,
    }));
  } catch (err) {
    process.stdout.write(JSON.stringify({
      ok: false,
      error: err.message || String(err),
    }));
  }
}

main();

