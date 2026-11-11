import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidSolanaAddress,
  normalizeXHandle,
  isValidXUrl,
  createCampaign,
  updateCampaign,
  deleteCampaign,
  submitCampaignCompletion,
  markSubmissionStatus,
  getSubmissionsForCampaign,
  getCampaignsWithUserStatus,
} from '../../src/server/campaigns-data.ts';

test('Campaigns & Rewards: Address and URL validators', () => {
  // Valid Solana addresses
  assert.equal(isValidSolanaAddress('11111111111111111111111111111111'), true);
  assert.equal(isValidSolanaAddress('FzFuSbWnTk7PR6fD84HHnE5w8qdwHjQr78HzfR817p3e'), true);
  assert.equal(isValidSolanaAddress('EM9M8RaxSjSf2UT2e2xndaBjjC1ijkT2nH5U3j6epump'), true);

  // Invalid addresses
  assert.equal(isValidSolanaAddress(''), false);
  assert.equal(isValidSolanaAddress('invalid_address'), false);
  assert.equal(isValidSolanaAddress('0x1234567890123456789012345678901234567890'), false);
  assert.equal(isValidSolanaAddress('123'), false);

  // X / Twitter Handle normalization
  assert.equal(normalizeXHandle('trader123'), '@trader123');
  assert.equal(normalizeXHandle('@trader123'), '@trader123');
  assert.equal(normalizeXHandle('@@@trader123'), '@trader123');
  assert.equal(normalizeXHandle('https://x.com/trader123'), '@trader123');
  assert.equal(normalizeXHandle('https://twitter.com/alpha_hunter'), '@alpha_hunter');

  // X / Twitter URL validation
  assert.equal(isValidXUrl('https://x.com/TrenchLabsHQ/status/1850000000000000000'), true);
  assert.equal(isValidXUrl('https://twitter.com/TrenchLabsHQ/status/1850000000000000000'), true);
  assert.equal(isValidXUrl('https://www.x.com/TrenchLabsHQ/status/123'), true);
  assert.equal(isValidXUrl('https://malicious-site.com/x.com'), false);
  assert.equal(isValidXUrl('https://google.com'), false);
  assert.equal(isValidXUrl('not_a_url'), false);
});

test('Campaigns & Rewards: Complete lifecycle, duplicate submission prevention, and airdrop distribution', async () => {
  // 1. Admin creates a new campaign
  const campaign = await createCampaign({
    title: 'Test X Raid Campaign',
    description: 'Raid test post and quote tweet.',
    tweetUrl: 'https://x.com/TrenchLabsHQ/status/1850000000000000000',
    rewardAmount: '25,000 $GENESIS',
    postedBy: 'FzFuSbWnTk7PR6fD84HHnE5w8qdwHjQr78HzfR817p3e',
  });

  assert.ok(campaign.id);
  assert.equal(campaign.title, 'Test X Raid Campaign');
  assert.equal(campaign.status, 'ACTIVE');

  const testWallet = '11111111111111111111111111111111';

  // 2. User submits completion proof
  const subResult = await submitCampaignCompletion({
    campaignId: campaign.id,
    walletAddress: testWallet,
    xHandle: '@solanaraider',
    xRetweetLink: 'https://x.com/solanaraider/status/999999999',
  });

  assert.equal(subResult.ok, true);
  assert.ok(subResult.submission);
  assert.equal(subResult.submission.status, 'PENDING');
  assert.equal(subResult.submission.walletAddress, testWallet);
  assert.equal(subResult.submission.xHandle, '@solanaraider');

  // 3. Duplicate submission attempt with same wallet is rejected
  const dupResult = await submitCampaignCompletion({
    campaignId: campaign.id,
    walletAddress: testWallet,
    xHandle: '@different_handle',
    xRetweetLink: 'https://x.com/different/status/111111111',
  });

  assert.equal(dupResult.ok, false);
  assert.match(dupResult.error || '', /already submitted/i);

  // 4. Invalid wallet submission is rejected
  const badWalletResult = await submitCampaignCompletion({
    campaignId: campaign.id,
    walletAddress: 'not_a_valid_solana_pubkey',
    xHandle: '@test',
    xRetweetLink: 'https://x.com/test/status/123',
  });
  assert.equal(badWalletResult.ok, false);
  assert.match(badWalletResult.error || '', /Invalid Solana wallet/i);

  // 5. Invalid tweet URL is rejected
  const badUrlResult = await submitCampaignCompletion({
    campaignId: campaign.id,
    walletAddress: 'EM9M8RaxSjSf2UT2e2xndaBjjC1ijkT2nH5U3j6epump',
    xHandle: '@test',
    xRetweetLink: 'https://phishing-site.com/fake',
  });
  assert.equal(badUrlResult.ok, false);
  assert.match(badUrlResult.error || '', /Invalid X \/ Twitter/i);

  // 6. Submissions list for admin
  const subs = await getSubmissionsForCampaign(campaign.id);
  assert.equal(subs.length, 1);
  assert.equal(subs[0].id, subResult.submission.id);

  // 7. Admin marks airdrop distributed
  const txHash = '5Ver7CJ4d1k6JvJm9JuG8F7z6kXn1sYQp2w3e4r5t6y7u8i9o0p';
  const airdropResult = await markSubmissionStatus(subResult.submission.id, 'AIRDROPPED', txHash);
  assert.equal(airdropResult.ok, true);

  // Verify updated submission status
  const updatedSubs = await getSubmissionsForCampaign(campaign.id);
  assert.equal(updatedSubs[0].status, 'AIRDROPPED');
  assert.equal(updatedSubs[0].airdropTx, txHash);
  assert.ok(updatedSubs[0].airdroppedAt);

  // 8. User status reflected on campaign query
  const campaignsForUser = await getCampaignsWithUserStatus(testWallet);
  const found = campaignsForUser.find((c) => c.id === campaign.id);
  assert.ok(found);
  assert.ok(found.userSubmission);
  assert.equal(found.userSubmission.status, 'AIRDROPPED');

  // 9. Campaign Priority Pinning lifecycle
  const pinnedCampaign = await updateCampaign(campaign.id, { pinned: true });
  assert.ok(pinnedCampaign);
  assert.equal(pinnedCampaign.pinned, true);
  assert.ok(pinnedCampaign.pinnedAt);

  const unpinnedCampaign = await updateCampaign(campaign.id, { pinned: false });
  assert.ok(unpinnedCampaign);
  assert.equal(unpinnedCampaign.pinned, false);
  assert.equal(unpinnedCampaign.pinnedAt, null);

  // Clean up test campaign
  await deleteCampaign(campaign.id);
});

test('Campaign Duration & Status: Persists and returns configured durationHours', async () => {
  const camp = await createCampaign({
    title: 'Duration Test Campaign',
    description: 'Testing configured duration persistence',
    tweetUrl: 'https://x.com/TrenchLabsHQ/status/1850000000000000001',
    rewardAmount: '10,000 $GENESIS',
    durationHours: 48,
    postedBy: 'FzFuSbWnTk7PR6fD84HHnE5w8qdwHjQr78HzfR817p3e',
  });

  try {
    assert.ok(camp.id);
    assert.equal(camp.durationHours, 48);
    assert.ok(camp.expiresAt);

    // Verify retrieval returns persisted duration
    const all = await getCampaignsWithUserStatus();
    const found = all.find((c) => c.id === camp.id);
    assert.ok(found);
    assert.equal(found.durationHours, 48);

    // Verify editing duration preserves and updates field
    const updated = await updateCampaign(camp.id, { durationHours: 72 });
    assert.ok(updated);
    assert.equal(updated.durationHours, 72);
  } finally {
    await deleteCampaign(camp.id);
  }
});

test('Campaign Status: PAUSED campaigns must remain PAUSED and never be treated as EXPIRED', async () => {
  const camp = await createCampaign({
    title: 'Paused Status Campaign',
    description: 'Testing paused vs expired state isolation',
    tweetUrl: 'https://x.com/TrenchLabsHQ/status/1850000000000000002',
    rewardAmount: '10,000 $GENESIS',
    durationHours: 24,
    postedBy: 'FzFuSbWnTk7PR6fD84HHnE5w8qdwHjQr78HzfR817p3e',
  });

  try {
    // Pause the campaign
    const paused = await updateCampaign(camp.id, { status: 'PAUSED' });
    assert.ok(paused);
    assert.equal(paused.status, 'PAUSED');

    // Verify submission to paused campaign is strictly rejected
    const subResult = await submitCampaignCompletion({
      campaignId: camp.id,
      walletAddress: '11111111111111111111111111111111',
      xHandle: '@paused_tester',
      xRetweetLink: 'https://x.com/tester/status/12345',
    });

    assert.equal(subResult.ok, false);
    assert.match(subResult.error || '', /paused/i);
  } finally {
    await deleteCampaign(camp.id);
  }
});

test('Campaign Status: Submissions to expired campaigns are rejected', async () => {
  // Create campaign with expired timestamp in the past
  const pastExpires = new Date(Date.now() - 3600 * 1000).toISOString();
  const camp = await createCampaign({
    title: 'Expired Timestamp Campaign',
    description: 'Testing expired submission rejection',
    tweetUrl: 'https://x.com/TrenchLabsHQ/status/1850000000000000003',
    rewardAmount: '10,000 $GENESIS',
    expiresAt: pastExpires,
    postedBy: 'FzFuSbWnTk7PR6fD84HHnE5w8qdwHjQr78HzfR817p3e',
  });

  try {
    const subResult = await submitCampaignCompletion({
      campaignId: camp.id,
      walletAddress: '11111111111111111111111111111111',
      xHandle: '@expired_tester',
      xRetweetLink: 'https://x.com/tester/status/54321',
    });

    assert.equal(subResult.ok, false);
    assert.match(subResult.error || '', /expired/i);
  } finally {
    await deleteCampaign(camp.id);
  }
});

