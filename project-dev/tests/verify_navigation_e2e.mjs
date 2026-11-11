import test from 'node:test';
import assert from 'node:assert/strict';

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3006';

test('E2E Route Verification: Direct URL access returns 200 without runtime errors', async () => {
  const routes = ['/', '/ledger', '/dashboard', '/dashboard/stake'];
  for (const route of routes) {
    const res = await fetch(`${BASE_URL}${route}`);
    assert.equal(res.status, 200, `Route ${route} must return 200 OK`);
    const html = await res.text();
    assert.ok(html.length > 500, `Route ${route} must have rendered HTML content`);
    assert.ok(!html.includes('Internal Server Error'), `Route ${route} must not crash`);
    assert.ok(!html.includes('Application error'), `Route ${route} must not have client error boundary`);
  }
});

test('E2E Public Navigation: Landing page contains working PERFORMANCE link and section anchors', async () => {
  const res = await fetch(`${BASE_URL}/`);
  const html = await res.text();

  // Desktop and mobile navigation links
  assert.ok(html.includes('href="/ledger"'), 'Public navigation must route to /ledger');
  assert.ok(html.includes('href="/#hero-section"'), 'Navigation must have /#hero-section');
  assert.ok(html.includes('href="/#how-it-works"'), 'Navigation must have /#how-it-works');
  assert.ok(html.includes('href="/#pipeline-section"'), 'Navigation must have /#pipeline-section');
  assert.ok(html.includes('href="/#choose-your-access"'), 'Navigation must have /#choose-your-access');

  // Performance Trust CTA
  assert.ok(html.includes('EXPLORE FULL LEDGER'), 'PerformanceTrustSection must have EXPLORE FULL LEDGER CTA');
});

test('E2E Performance Ledger: /ledger page contains active navigation and back links', async () => {
  const res = await fetch(`${BASE_URL}/ledger`);
  const html = await res.text();

  assert.ok(html.includes('Official Performance Ledger'), 'Must render Official Performance Ledger title');
  assert.ok(html.includes('href="/#hero-section"'), 'Must have root-relative link to Home');
  assert.ok(html.includes('href="/#how-it-works"'), 'Must have root-relative link to How It Works');
  assert.ok(html.includes('href="/#pipeline-section"'), 'Must have root-relative link to Incubator');
  assert.ok(html.includes('href="/#choose-your-access"'), 'Must have root-relative link to Membership');
});

test('E2E Terminal Header: /dashboard contains working Ledger and Dashboard links without dead anchors', async () => {
  const res = await fetch(`${BASE_URL}/dashboard`);
  const html = await res.text();

  assert.ok(!html.includes('href="#ledger-embed"'), 'Must not contain dead #ledger-embed link in header');
  assert.ok(html.includes('href="/ledger"'), 'Terminal navigation must link to /ledger');
  assert.ok(html.includes('View full ledger'), 'Dashboard embed must have View full ledger link');
});

test('E2E Dashboard Tabs & State Sync: /dashboard with query params', async () => {
  // Check tab query parameter handling on dashboard
  const resSocial = await fetch(`${BASE_URL}/dashboard?tab=SOCIAL`);
  assert.equal(resSocial.status, 200);

  const resAlpha = await fetch(`${BASE_URL}/dashboard?tab=ALPHA`);
  assert.equal(resAlpha.status, 200);

  const resWatchlist = await fetch(`${BASE_URL}/dashboard?tab=WATCHLIST`);
  assert.equal(resWatchlist.status, 200);

  const resMaxAlpha = await fetch(`${BASE_URL}/dashboard?tab=MAX_ALPHA`);
  assert.equal(resMaxAlpha.status, 200);
});
