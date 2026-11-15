import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  INITIATION_TWEET_TEXT,
  INITIATION_INTENT_URL,
  isValidXPostUrl,
} from '../../src/components/campaigns/SocialInitiationCard.tsx';

const ROOT_DIR = process.cwd();

describe('SocialInitiationCard — permanent early campaign & social tab gate', () => {
  it('contains exact campaign copy including @Trenchlabshq, $H42, #SOL, and #Trenchlabs', () => {
    assert.ok(
      INITIATION_TWEET_TEXT.includes(
        "I am now an official assistant of TrenchLabs and I earn by carrying out tasks. TrenchLabs got some crazy Alpha's - check it out here www.trenchlabshq.xyz"
      )
    );
    assert.ok(INITIATION_TWEET_TEXT.includes('@Trenchlabshq'));
    assert.ok(INITIATION_TWEET_TEXT.includes('$H42'));
    assert.ok(INITIATION_TWEET_TEXT.includes('#SOL'));
    assert.ok(INITIATION_TWEET_TEXT.includes('#Trenchlabs'));
    assert.ok(INITIATION_INTENT_URL.startsWith('https://x.com/intent/tweet?text='));
  });

  it('validates X / Twitter status URLs accurately', () => {
    assert.equal(isValidXPostUrl('https://x.com/trenchuser/status/189999999999'), true);
    assert.equal(isValidXPostUrl('https://twitter.com/trenchuser/status/189999999999'), true);
    assert.equal(isValidXPostUrl('https://example.com/status/123'), false);
    assert.equal(isValidXPostUrl(''), false);
  });

  it('mounts SocialInitiationCard in CampaignSection and gates live social cards until completed', () => {
    const sectionSrc = fs.readFileSync(
      path.join(ROOT_DIR, 'src/components/campaigns/CampaignSection.tsx'),
      'utf8'
    );
    assert.ok(
      sectionSrc.includes('<SocialInitiationCard'),
      'CampaignSection must render permanent SocialInitiationCard'
    );
    assert.ok(
      sectionSrc.includes('locked-social-card-gate'),
      'CampaignSection must gate live CampaignCards until initiation is completed'
    );
  });
});
