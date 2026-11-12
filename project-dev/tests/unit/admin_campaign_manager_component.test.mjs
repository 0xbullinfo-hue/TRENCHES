import test from 'node:test';
import assert from 'node:assert/strict';
import { installDomShim } from './helpers/dom-shim.mjs';

const dom = installDomShim();

const React = await import('react');
const { act } = React;
const { createRoot } = await import('react-dom/client');
const { AdminCampaignManager } = await import('../../src/components/admin/AdminCampaignManager.tsx');

function makeDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function makeCampaign(overrides = {}) {
  return {
    id: 'camp-1',
    title: 'Alpha Raid One',
    tweetUrl: 'https://x.com/trenchlabs/status/1850000000000000001',
    rewardAmount: '50 USDC',
    totalPool: '500 USDC',
    description: 'Like and repost',
    status: 'ACTIVE',
    pinned: false,
    durationHours: 24,
    createdAt: '2026-11-01T00:00:00.000Z',
    expiresAt: '2026-11-02T00:00:00.000Z',
    submissionCount: 0,
    ...overrides,
  };
}

function makeSubmission(overrides = {}) {
  return {
    id: 'sub-1',
    campaignId: 'camp-1',
    walletAddress: '11111111111111111111111111111111',
    xHandle: '@raider1',
    xRetweetLink: 'https://x.com/raider1/status/1850000000000000111',
    status: 'PENDING',
    submittedAt: '2026-11-01T01:00:00.000Z',
    ...overrides,
  };
}

function withMockFetch(handler) {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const urlStr = String(url);
    const method = (init.method || 'GET').toUpperCase();
    const body = init.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url: urlStr, method, body });
    return handler({ url: urlStr, method, body, calls });
  };
  return {
    calls,
    restore() {
      globalThis.fetch = originalFetch;
    },
  };
}

async function mountAdminManager({ onToast = () => {}, getAdminHeaders } = {}) {
  const container = dom.document.createElement('div');
  dom.document.body.appendChild(container);
  let root;

  await act(async () => {
    root = createRoot(container);
    root.render(
      React.createElement(AdminCampaignManager, {
        onToast,
        getAdminHeaders:
          getAdminHeaders || (async () => ({ 'x-admin-test': 'ok' })),
      })
    );
  });

  async function flush(ms = 15) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, ms));
    });
  }

  async function unmount() {
    await act(async () => {
      root.unmount();
    });
    if (container.parentNode) {
      container.parentNode.removeChild(container);
    }
  }

  await flush(20);
  return { container, flush, unmount };
}

function findButtonByText(container, text) {
  const buttons = Array.from(container.querySelectorAll('button'));
  return buttons.find((b) => b.textContent.includes(text));
}

function findEditButton(container) {
  const buttons = Array.from(container.querySelectorAll('button'));
  return buttons.find(
    (b) => b.getAttribute('title') === 'Edit Raid Campaign' || b.textContent.includes('EDIT RAID')
  );
}

// ============================================================================
// PART 3: ADMIN CAMPAIGN EDITING & DURATION PRESERVATION (5 Tests)
// ============================================================================

for (const hours of [12, 48, 168]) {
  test(`V1.4 Duration [${hours}h]: Editing campaign preserves ${hours}h duration without resetting to 24h`, async () => {
    const camp = makeCampaign({ id: `camp-${hours}`, durationHours: hours });
    let patchBody = null;

    const fx = withMockFetch(({ url, method, body }) => {
      if ((url === '/api/campaigns' || url === '/api/admin/campaigns') && method === 'GET') {
        return jsonResponse({ ok: true, campaigns: [camp] });
      }
      if (url === `/api/admin/campaigns/${camp.id}` && method === 'PATCH') {
        patchBody = body;
        return jsonResponse({ ok: true, campaign: { ...camp, ...body } });
      }
      return jsonResponse({ ok: true, submissions: [] });
    });

    const mounted = await mountAdminManager();
    try {
      const editBtn = findEditButton(mounted.container);
      assert.ok(editBtn, 'Expected Edit Raid button');
      await act(async () => {
        editBtn.click();
      });

      const select = mounted.container.querySelector('select');
      assert.ok(select, 'Expected duration select');
      assert.equal(select.value, String(hours));

      const form = mounted.container.querySelector('form');
      assert.ok(form, 'Expected edit form');
      await act(async () => {
        dom.submitForm(form);
      });
      await mounted.flush(20);

      assert.ok(patchBody, 'Expected PATCH request');
      assert.equal(patchBody.durationHours, hours);
    } finally {
      await mounted.unmount();
      fx.restore();
    }
  });
}

test('V1.4 Duration [4/5]: Deliberately changing duration while editing sends updated durationHours', async () => {
  const camp = makeCampaign({ id: 'camp-change', durationHours: 48 });
  let patchBody = null;

  const fx = withMockFetch(({ url, method, body }) => {
    if ((url === '/api/campaigns' || url === '/api/admin/campaigns') && method === 'GET') {
      return jsonResponse({ ok: true, campaigns: [camp] });
    }
    if (url === `/api/admin/campaigns/${camp.id}` && method === 'PATCH') {
      patchBody = body;
      return jsonResponse({ ok: true, campaign: { ...camp, ...body } });
    }
    return jsonResponse({ ok: true, submissions: [] });
  });

  const mounted = await mountAdminManager();
  try {
    await act(async () => {
      findEditButton(mounted.container).click();
    });

    const select = mounted.container.querySelector('select');
    assert.equal(select.value, '48');

    await act(async () => {
      dom.setSelectValue(select, '336');
    });
    assert.equal(select.value, '336');

    await act(async () => {
      dom.submitForm(mounted.container.querySelector('form'));
    });
    await mounted.flush(20);

    assert.equal(patchBody.durationHours, 336);
  } finally {
    await mounted.unmount();
    fx.restore();
  }
});

test('V1.4 Duration [5/5]: Legacy campaign without durationHours safely falls back to 24h (or non-preset diff)', async () => {
  const legacyNoDates = makeCampaign({
    id: 'camp-legacy',
    durationHours: undefined,
    createdAt: undefined,
    expiresAt: undefined,
  });
  let patchBody = null;

  const fx = withMockFetch(({ url, method, body }) => {
    if ((url === '/api/campaigns' || url === '/api/admin/campaigns') && method === 'GET') {
      return jsonResponse({ ok: true, campaigns: [legacyNoDates] });
    }
    if (url === `/api/admin/campaigns/${legacyNoDates.id}` && method === 'PATCH') {
      patchBody = body;
      return jsonResponse({ ok: true, campaign: { ...legacyNoDates, ...body } });
    }
    return jsonResponse({ ok: true, submissions: [] });
  });

  const mounted = await mountAdminManager();
  try {
    await act(async () => {
      findEditButton(mounted.container).click();
    });
    const select = mounted.container.querySelector('select');
    assert.equal(select.value, '24');

    await act(async () => {
      dom.submitForm(mounted.container.querySelector('form'));
    });
    await mounted.flush(20);

    assert.equal(patchBody.durationHours, 24);
  } finally {
    await mounted.unmount();
    fx.restore();
  }
});

// ============================================================================
// PART 4: ADMIN SUBMISSION-LIST CONSISTENCY & ERROR HANDLING (9 Tests)
// ============================================================================

test('V1.4 Submissions [1/9]: Switching A -> B while A is pending discards late A response and shows B submissions', async () => {
  const campA = makeCampaign({ id: 'camp-A', title: 'Campaign Alpha' });
  const campB = makeCampaign({ id: 'camp-B', title: 'Campaign Beta' });
  const deferredA = makeDeferred();

  const fx = withMockFetch(({ url, method }) => {
    if ((url === '/api/campaigns' || url === '/api/admin/campaigns') && method === 'GET') {
      return jsonResponse({ ok: true, campaigns: [campA, campB] });
    }
    if (url === '/api/admin/campaigns/camp-A/submissions') {
      return deferredA.promise;
    }
    if (url === '/api/admin/campaigns/camp-B/submissions') {
      return jsonResponse({
        ok: true,
        submissions: [makeSubmission({ id: 'sub-B', campaignId: 'camp-B', xHandle: '@beta_user' })],
      });
    }
    return jsonResponse({}, 500);
  });

  const mounted = await mountAdminManager();
  try {
    await act(async () => {
      findButtonByText(mounted.container, 'Campaign Alpha').click();
    });
    await mounted.flush(10);

    await act(async () => {
      findButtonByText(mounted.container, 'Campaign Beta').click();
    });
    await mounted.flush(25);

    assert.ok(mounted.container.textContent.includes('@beta_user'));

    deferredA.resolve(
      jsonResponse({
        ok: true,
        submissions: [makeSubmission({ id: 'sub-A', campaignId: 'camp-A', xHandle: '@alpha_stale' })],
      })
    );
    await mounted.flush(25);

    assert.ok(mounted.container.textContent.includes('@beta_user'));
    assert.ok(!mounted.container.textContent.includes('@alpha_stale'));
  } finally {
    await mounted.unmount();
    fx.restore();
  }
});

test('V1.4 Submissions [2/9]: Rapid A -> B -> A switching ignores stale intermediate B response', async () => {
  const campA = makeCampaign({ id: 'camp-A', title: 'Campaign Alpha' });
  const campB = makeCampaign({ id: 'camp-B', title: 'Campaign Beta' });
  const deferredB = makeDeferred();
  let callCountA = 0;

  const fx = withMockFetch(({ url, method }) => {
    if ((url === '/api/campaigns' || url === '/api/admin/campaigns') && method === 'GET') {
      return jsonResponse({ ok: true, campaigns: [campA, campB] });
    }
    if (url === '/api/admin/campaigns/camp-A/submissions') {
      callCountA += 1;
      return jsonResponse({
        ok: true,
        submissions: [
          makeSubmission({
            id: `sub-A-${callCountA}`,
            campaignId: 'camp-A',
            xHandle: `@alpha_latest_${callCountA}`,
          }),
        ],
      });
    }
    if (url === '/api/admin/campaigns/camp-B/submissions') {
      return deferredB.promise;
    }
    return jsonResponse({}, 500);
  });

  const mounted = await mountAdminManager();
  try {
    await act(async () => {
      findButtonByText(mounted.container, 'Campaign Alpha').click();
    });
    await mounted.flush(15);

    await act(async () => {
      findButtonByText(mounted.container, 'Campaign Beta').click();
    });
    await mounted.flush(10);

    await act(async () => {
      findButtonByText(mounted.container, 'Campaign Alpha').click();
    });
    await mounted.flush(25);

    deferredB.resolve(
      jsonResponse({
        ok: true,
        submissions: [makeSubmission({ id: 'sub-B-stale', campaignId: 'camp-B', xHandle: '@beta_stale' })],
      })
    );
    await mounted.flush(25);

    assert.ok(mounted.container.textContent.includes('@alpha_latest_2'));
    assert.ok(!mounted.container.textContent.includes('@beta_stale'));
  } finally {
    await mounted.unmount();
    fx.restore();
  }
});

test('V1.4 Submissions [3/9]: Stale request error from A does not overwrite B submissions or show toast', async () => {
  const campA = makeCampaign({ id: 'camp-A', title: 'Campaign Alpha' });
  const campB = makeCampaign({ id: 'camp-B', title: 'Campaign Beta' });
  const deferredA = makeDeferred();
  const toasts = [];

  const fx = withMockFetch(({ url, method }) => {
    if ((url === '/api/campaigns' || url === '/api/admin/campaigns') && method === 'GET') {
      return jsonResponse({ ok: true, campaigns: [campA, campB] });
    }
    if (url === '/api/admin/campaigns/camp-A/submissions') {
      return deferredA.promise;
    }
    if (url === '/api/admin/campaigns/camp-B/submissions') {
      return jsonResponse({
        ok: true,
        submissions: [makeSubmission({ id: 'sub-B', campaignId: 'camp-B', xHandle: '@beta_ok' })],
      });
    }
    return jsonResponse({}, 500);
  });

  const mounted = await mountAdminManager({
    onToast: (msg, type) => toasts.push({ msg, type }),
  });
  try {
    await act(async () => {
      findButtonByText(mounted.container, 'Campaign Alpha').click();
    });
    await mounted.flush(10);

    await act(async () => {
      findButtonByText(mounted.container, 'Campaign Beta').click();
    });
    await mounted.flush(25);

    deferredA.reject(new Error('Network error for A'));
    await mounted.flush(25);

    assert.ok(mounted.container.textContent.includes('@beta_ok'));
    assert.equal(toasts.filter((t) => t.type === 'error').length, 0);
  } finally {
    await mounted.unmount();
    fx.restore();
  }
});

test('V1.4 Submissions [4/9]: HTTP 401/403 displays authentication error and Retry button instead of empty state', async () => {
  const campA = makeCampaign({ id: 'camp-A', title: 'Campaign Alpha' });

  const fx = withMockFetch(({ url, method }) => {
    if ((url === '/api/campaigns' || url === '/api/admin/campaigns') && method === 'GET') {
      return jsonResponse({ ok: true, campaigns: [campA] });
    }
    if (url === '/api/admin/campaigns/camp-A/submissions') {
      return jsonResponse({ ok: false, error: 'Unauthorized' }, 401);
    }
    return jsonResponse({}, 500);
  });

  const mounted = await mountAdminManager();
  try {
    await act(async () => {
      findButtonByText(mounted.container, 'Campaign Alpha').click();
    });
    await mounted.flush(25);

    assert.ok(mounted.container.textContent.includes('Authentication required or expired'));
    assert.ok(!mounted.container.textContent.includes('No user submissions yet for this campaign.'));
    assert.ok(findButtonByText(mounted.container, 'Retry'));
  } finally {
    await mounted.unmount();
    fx.restore();
  }
});

test('V1.4 Submissions [5/9]: HTTP 500 displays retrieval error and Retry button instead of empty state', async () => {
  const campA = makeCampaign({ id: 'camp-A', title: 'Campaign Alpha' });

  const fx = withMockFetch(({ url, method }) => {
    if ((url === '/api/campaigns' || url === '/api/admin/campaigns') && method === 'GET') {
      return jsonResponse({ ok: true, campaigns: [campA] });
    }
    if (url === '/api/admin/campaigns/camp-A/submissions') {
      return jsonResponse({ ok: false, error: 'Database offline' }, 500);
    }
    return jsonResponse({}, 500);
  });

  const mounted = await mountAdminManager();
  try {
    await act(async () => {
      findButtonByText(mounted.container, 'Campaign Alpha').click();
    });
    await mounted.flush(25);

    assert.ok(mounted.container.textContent.includes('Database offline'));
    assert.ok(!mounted.container.textContent.includes('No user submissions yet for this campaign.'));
    assert.ok(findButtonByText(mounted.container, 'Retry'));
  } finally {
    await mounted.unmount();
    fx.restore();
  }
});

test('V1.4 Submissions [6/9]: Switching to another campaign clears previous submissions immediately while loading', async () => {
  const campA = makeCampaign({ id: 'camp-A', title: 'Campaign Alpha' });
  const campB = makeCampaign({ id: 'camp-B', title: 'Campaign Beta' });
  const deferredB = makeDeferred();

  const fx = withMockFetch(({ url, method }) => {
    if ((url === '/api/campaigns' || url === '/api/admin/campaigns') && method === 'GET') {
      return jsonResponse({ ok: true, campaigns: [campA, campB] });
    }
    if (url === '/api/admin/campaigns/camp-A/submissions') {
      return jsonResponse({
        ok: true,
        submissions: [makeSubmission({ id: 'sub-A', campaignId: 'camp-A', xHandle: '@alpha_only' })],
      });
    }
    if (url === '/api/admin/campaigns/camp-B/submissions') {
      return deferredB.promise;
    }
    return jsonResponse({}, 500);
  });

  const mounted = await mountAdminManager();
  try {
    await act(async () => {
      findButtonByText(mounted.container, 'Campaign Alpha').click();
    });
    await mounted.flush(25);
    assert.ok(mounted.container.textContent.includes('@alpha_only'));

    await act(async () => {
      findButtonByText(mounted.container, 'Campaign Beta').click();
    });
    await mounted.flush(10);

    assert.ok(!mounted.container.textContent.includes('@alpha_only'));
    assert.ok(mounted.container.textContent.includes('Loading submissions...'));

    deferredB.resolve(jsonResponse({ ok: true, submissions: [] }));
    await mounted.flush(25);
  } finally {
    await mounted.unmount();
    fx.restore();
  }
});

test('V1.4 Submissions [7/9]: Confirmed empty 200 response displays empty message without error', async () => {
  const campA = makeCampaign({ id: 'camp-A', title: 'Campaign Alpha' });

  const fx = withMockFetch(({ url, method }) => {
    if ((url === '/api/campaigns' || url === '/api/admin/campaigns') && method === 'GET') {
      return jsonResponse({ ok: true, campaigns: [campA] });
    }
    if (url === '/api/admin/campaigns/camp-A/submissions') {
      return jsonResponse({ ok: true, submissions: [] });
    }
    return jsonResponse({}, 500);
  });

  const mounted = await mountAdminManager();
  try {
    await act(async () => {
      findButtonByText(mounted.container, 'Campaign Alpha').click();
    });
    await mounted.flush(25);

    assert.ok(mounted.container.textContent.includes('No user submissions yet for this campaign.'));
    assert.ok(!findButtonByText(mounted.container, 'Retry'));
  } finally {
    await mounted.unmount();
    fx.restore();
  }
});

test('V1.4 Submissions [8/9]: Clicking Retry after error re-fetches submissions and recovers', async () => {
  const campA = makeCampaign({ id: 'camp-A', title: 'Campaign Alpha' });
  let attempt = 0;

  const fx = withMockFetch(({ url, method }) => {
    if ((url === '/api/campaigns' || url === '/api/admin/campaigns') && method === 'GET') {
      return jsonResponse({ ok: true, campaigns: [campA] });
    }
    if (url === '/api/admin/campaigns/camp-A/submissions') {
      attempt += 1;
      if (attempt === 1) {
        return jsonResponse({ ok: false, error: 'Temporary 500 failure' }, 500);
      }
      return jsonResponse({
        ok: true,
        submissions: [makeSubmission({ id: 'sub-A-ok', campaignId: 'camp-A', xHandle: '@recovered_user' })],
      });
    }
    return jsonResponse({}, 500);
  });

  const mounted = await mountAdminManager();
  try {
    await act(async () => {
      findButtonByText(mounted.container, 'Campaign Alpha').click();
    });
    await mounted.flush(25);
    assert.ok(mounted.container.textContent.includes('Temporary 500 failure'));

    const retryBtn = findButtonByText(mounted.container, 'Retry');
    assert.ok(retryBtn);
    await act(async () => {
      retryBtn.click();
    });
    await mounted.flush(25);

    assert.ok(mounted.container.textContent.includes('@recovered_user'));
    assert.ok(!mounted.container.textContent.includes('Temporary 500 failure'));
  } finally {
    await mounted.unmount();
    fx.restore();
  }
});

test('V1.4 Submissions [9/9]: Unmounting while submissions request is in-flight does not throw or trigger error toast', async () => {
  const campA = makeCampaign({ id: 'camp-A', title: 'Campaign Alpha' });
  const deferredA = makeDeferred();
  const toasts = [];

  const fx = withMockFetch(({ url, method }) => {
    if ((url === '/api/campaigns' || url === '/api/admin/campaigns') && method === 'GET') {
      return jsonResponse({ ok: true, campaigns: [campA] });
    }
    if (url === '/api/admin/campaigns/camp-A/submissions') {
      return deferredA.promise;
    }
    return jsonResponse({}, 500);
  });

  const mounted = await mountAdminManager({
    onToast: (msg, type) => toasts.push({ msg, type }),
  });
  await act(async () => {
    findButtonByText(mounted.container, 'Campaign Alpha').click();
  });
  await mounted.flush(10);

  await mounted.unmount();
  deferredA.resolve(jsonResponse({ ok: false, error: 'Late failure after unmount' }, 500));
  await new Promise((r) => setTimeout(r, 25));

  assert.equal(toasts.length, 0);
  fx.restore();
});

test('V1.5 Submissions [10/10]: Campaign A resolving BEFORE Campaign B finishes never overwrites B or clears B loading indicator, and returning to A loads A', async () => {
  const campA = makeCampaign({ id: 'camp-A', title: 'Campaign Alpha' });
  const campB = makeCampaign({ id: 'camp-B', title: 'Campaign Beta' });
  const deferredA1 = makeDeferred();
  const deferredB = makeDeferred();
  let callsA = 0;

  const fx = withMockFetch(({ url, method }) => {
    if ((url === '/api/campaigns' || url === '/api/admin/campaigns') && method === 'GET') {
      return jsonResponse({ ok: true, campaigns: [campA, campB] });
    }
    if (url === '/api/admin/campaigns/camp-A/submissions') {
      callsA += 1;
      if (callsA === 1) {
        return deferredA1.promise;
      }
      return jsonResponse({
        ok: true,
        submissions: [makeSubmission({ id: 'sub-A2', campaignId: 'camp-A', xHandle: '@alpha_returned' })],
      });
    }
    if (url === '/api/admin/campaigns/camp-B/submissions') {
      return deferredB.promise;
    }
    return jsonResponse({}, 500);
  });

  const mounted = await mountAdminManager();
  try {
    // Select B immediately while initial A request is in-flight
    await act(async () => {
      findButtonByText(mounted.container, 'Campaign Beta').click();
    });
    assert.ok(mounted.container.textContent.includes('Loading submissions...'));

    // A resolves BEFORE B finishes
    deferredA1.resolve(
      jsonResponse({
        ok: true,
        submissions: [makeSubmission({ id: 'sub-A1', campaignId: 'camp-A', xHandle: '@alpha_early_stale' })],
      })
    );
    await mounted.flush(20);

    // Must NOT show A's data and must STILL show B's loading indicator
    assert.ok(!mounted.container.textContent.includes('@alpha_early_stale'));
    assert.ok(mounted.container.textContent.includes('Loading submissions...'));

    // Now B finishes
    deferredB.resolve(
      jsonResponse({
        ok: true,
        submissions: [makeSubmission({ id: 'sub-B', campaignId: 'camp-B', xHandle: '@beta_ready' })],
      })
    );
    await mounted.flush(25);
    assert.ok(mounted.container.textContent.includes('@beta_ready'));

    // Returning to A loads A's latest data
    await act(async () => {
      findButtonByText(mounted.container, 'Campaign Alpha').click();
    });
    await mounted.flush(25);
    assert.ok(mounted.container.textContent.includes('@alpha_returned'));
  } finally {
    await mounted.unmount();
    fx.restore();
  }
});
