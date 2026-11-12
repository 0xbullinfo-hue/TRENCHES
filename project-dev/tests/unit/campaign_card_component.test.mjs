import test from 'node:test';
import assert from 'node:assert/strict';
import { installDomShim } from './helpers/dom-shim.mjs';

// Install DOM shim BEFORE importing React / CampaignCard
const dom = installDomShim();

const {
  makeMockPublicKey,
  makeMockWalletContext,
  makeMockGenesisContext,
  makeSampleCampaign,
  mountCampaignCard,
} = await import('./helpers/campaign_card_harness.tsx');
const { act } = await import('react');

const WALLET_A = '11111111111111111111111111111111';
const WALLET_B = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

function fillValidFields(container, walletAddr = WALLET_A) {
  act(() => {
    const walletInput = container.querySelector('#wallet-camp-ux-test-1');
    const xHandleInput = container.querySelector('#xhandle-camp-ux-test-1');
    const retweetInput = container.querySelector('#retweet-camp-ux-test-1');
    if (walletInput && walletAddr !== undefined) {
      dom.setInputValue(walletInput, walletAddr);
    }
    if (xHandleInput) {
      dom.setInputValue(xHandleInput, '@raider_hero');
    }
    if (retweetInput) {
      dom.setInputValue(retweetInput, 'https://x.com/raider_hero/status/1850000000000000999');
    }
  });
}

function getSubmitButton(container) {
  return container.querySelector('button[type="submit"]');
}

function getForm(container) {
  return container.querySelector('form');
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

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload;
    },
  };
}

function makeDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test('Component [1/22]: Disconnected adapter with stale publicKeyBase58 blocks submission', async () => {
  const fx = withMockFetch(() => jsonResponse({ authenticated: false }, 401));
  const mounted = await mountCampaignCard({
    walletContext: makeMockWalletContext({
      connected: false,
      publicKey: null,
      wallet: null,
    }),
    genesisContext: makeMockGenesisContext({
      connected: true,
      publicKeyBase58: WALLET_A,
      needsSignature: false,
      verificationState: 'VERIFIED',
    }),
    userWallet: WALLET_A,
  });

  try {
    assert.ok(mounted.container.textContent.includes('No wallet connected'));
    assert.ok(!mounted.container.textContent.includes('Wallet Authenticated & Ready'));
    const btn = getSubmitButton(mounted.container);
    assert.equal(btn.disabled, true);
    assert.ok(btn.textContent.includes('Connect Wallet to Submit'));

    fillValidFields(mounted.container, WALLET_A);
    dom.submitForm(getForm(mounted.container));
    await mounted.flush();

    assert.equal(
      fx.calls.filter((c) => c.url.includes('/submit')).length,
      0,
      'Submit endpoint must not be called'
    );
  } finally {
    await mounted.unmount();
    fx.restore();
  }
});

test('Component [2/22]: Connected adapter with missing public key blocks submission', async () => {
  const fx = withMockFetch(() => jsonResponse({ authenticated: false }, 401));
  const mounted = await mountCampaignCard({
    walletContext: makeMockWalletContext({
      connected: true,
      publicKey: null,
      adapterConnected: true,
      adapterPublicKey: null,
      signMessage: async () => new Uint8Array(64),
    }),
  });

  try {
    assert.ok(mounted.container.textContent.includes('No wallet connected'));
    const btn = getSubmitButton(mounted.container);
    assert.equal(btn.disabled, true);

    fillValidFields(mounted.container, WALLET_A);
    dom.submitForm(getForm(mounted.container));
    await mounted.flush();

    assert.equal(fx.calls.filter((c) => c.url.includes('/submit')).length, 0);
  } finally {
    await mounted.unmount();
    fx.restore();
  }
});

test('Component [3/22]: Connected wallet with no server session does not show authenticated banner', async () => {
  const fx = withMockFetch(() => jsonResponse({ authenticated: false }, 401));
  const mounted = await mountCampaignCard({
    walletContext: makeMockWalletContext({
      connected: true,
      publicKey: makeMockPublicKey(WALLET_A),
      signMessage: async () => new Uint8Array(64),
    }),
    genesisContext: makeMockGenesisContext({
      connected: true,
      publicKeyBase58: WALLET_A,
      needsSignature: false,
      verificationState: 'VERIFIED',
    }),
  });

  try {
    assert.ok(!mounted.container.textContent.includes('Wallet Authenticated & Ready'));
    assert.ok(mounted.container.textContent.includes('Authentication required'));
  } finally {
    await mounted.unmount();
    fx.restore();
  }
});

test('Component [4/22]: Server session belonging to another wallet is rejected', async () => {
  const fx = withMockFetch(() =>
    jsonResponse({ authenticated: true, wallet: WALLET_B }, 200)
  );
  const mounted = await mountCampaignCard({
    walletContext: makeMockWalletContext({
      connected: true,
      publicKey: makeMockPublicKey(WALLET_A),
      signMessage: async () => new Uint8Array(64),
    }),
  });

  try {
    assert.ok(!mounted.container.textContent.includes('Wallet Authenticated & Ready'));
    assert.ok(mounted.container.textContent.includes('Authentication required'));
  } finally {
    await mounted.unmount();
    fx.restore();
  }
});

test('Component [5/22]: Server session confirming matching wallet shows ready state', async () => {
  const fx = withMockFetch(() =>
    jsonResponse({ authenticated: true, wallet: WALLET_A }, 200)
  );
  const mounted = await mountCampaignCard({
    walletContext: makeMockWalletContext({
      connected: true,
      publicKey: makeMockPublicKey(WALLET_A),
      signMessage: async () => new Uint8Array(64),
    }),
  });

  try {
    assert.ok(mounted.container.textContent.includes('Wallet Authenticated & Ready'));
  } finally {
    await mounted.unmount();
    fx.restore();
  }
});

test('Component [6/22]: Wallet changes during session lookup ignores stale response', async () => {
  const deferredSessionA = makeDeferred();
  const fx = withMockFetch(({ url }) => {
    if (url === '/api/auth/session') {
      if (fx.calls.length === 1) return deferredSessionA.promise;
      return jsonResponse({ authenticated: false }, 401);
    }
    return jsonResponse({}, 404);
  });

  const mounted = await mountCampaignCard({
    walletContext: makeMockWalletContext({
      connected: true,
      publicKey: makeMockPublicKey(WALLET_A),
      signMessage: async () => new Uint8Array(64),
    }),
  });

  try {
    // Switch to Wallet B while Wallet A's session lookup is still pending
    await mounted.update({
      walletContext: makeMockWalletContext({
        connected: true,
        publicKey: makeMockPublicKey(WALLET_B),
        signMessage: async () => new Uint8Array(64),
      }),
    });

    // Resolve stale Wallet A session response as authenticated for WALLET_A
    deferredSessionA.resolve(jsonResponse({ authenticated: true, wallet: WALLET_A }, 200));
    await mounted.flush(20);

    assert.ok(
      !mounted.container.textContent.includes('Wallet Authenticated & Ready'),
      'Stale Wallet A session response must not mark Wallet B as authenticated'
    );
  } finally {
    await mounted.unmount();
    fx.restore();
  }
});

test('Component [7/22]: Wallet changes during session signing aborts operation', async () => {
  const signDeferred = makeDeferred();
  const fx = withMockFetch(({ url, method }) => {
    if (url === '/api/auth/session' && method === 'GET') {
      return jsonResponse({ authenticated: false }, 401);
    }
    return jsonResponse({}, 500);
  });

  const mounted = await mountCampaignCard({
    walletContext: makeMockWalletContext({
      connected: true,
      publicKey: makeMockPublicKey(WALLET_A),
      signMessage: () => signDeferred.promise,
    }),
  });

  try {
    fillValidFields(mounted.container, WALLET_A);
    dom.submitForm(getForm(mounted.container));
    await mounted.flush(15);

    // Switch wallet during session signing
    await mounted.update({
      walletContext: makeMockWalletContext({
        connected: true,
        publicKey: makeMockPublicKey(WALLET_B),
        signMessage: async () => new Uint8Array(64),
      }),
    });

    signDeferred.resolve(new Uint8Array(64).fill(1));
    await mounted.flush(20);

    assert.equal(fx.calls.filter((c) => c.method === 'POST').length, 0);
  } finally {
    await mounted.unmount();
    fx.restore();
  }
});

test('Component [8/22]: Wallet changes during session authentication aborts operation', async () => {
  const authPostDeferred = makeDeferred();
  let getCount = 0;
  const fx = withMockFetch(({ url, method }) => {
    if (url === '/api/auth/session' && method === 'GET') {
      getCount += 1;
      return jsonResponse({ authenticated: false }, 401);
    }
    if (url === '/api/auth/session' && method === 'POST') {
      return authPostDeferred.promise;
    }
    return jsonResponse({}, 500);
  });

  const mounted = await mountCampaignCard({
    walletContext: makeMockWalletContext({
      connected: true,
      publicKey: makeMockPublicKey(WALLET_A),
      signMessage: async () => new Uint8Array(64).fill(2),
    }),
  });

  try {
    fillValidFields(mounted.container, WALLET_A);
    dom.submitForm(getForm(mounted.container));
    await mounted.flush(20);

    // Switch wallet while POST /api/auth/session is pending
    await mounted.update({
      walletContext: makeMockWalletContext({
        connected: true,
        publicKey: makeMockPublicKey(WALLET_B),
        signMessage: async () => new Uint8Array(64),
      }),
    });

    authPostDeferred.resolve(jsonResponse({ ok: true, wallet: WALLET_A }, 200));
    await mounted.flush(20);

    assert.equal(fx.calls.filter((c) => c.url.includes('/challenge')).length, 0);
    assert.equal(fx.calls.filter((c) => c.url.includes('/submit')).length, 0);
    assert.ok(getCount >= 1);
  } finally {
    await mounted.unmount();
    fx.restore();
  }
});

test('Component [9/22]: Challenge response missing campaignId is rejected', async () => {
  const fx = withMockFetch(({ url, method }) => {
    if (url === '/api/auth/session' && method === 'GET') {
      return jsonResponse({ authenticated: true, wallet: WALLET_A }, 200);
    }
    if (url.includes('/challenge') && method === 'POST') {
      return jsonResponse({
        ok: true,
        challengeId: 'rc_123456',
        message: 'TrenchLabs Raid Challenge|rc_123456',
        walletAddress: WALLET_A,
      }, 201);
    }
    return jsonResponse({}, 500);
  });

  let signCalled = false;
  const mounted = await mountCampaignCard({
    walletContext: makeMockWalletContext({
      connected: true,
      publicKey: makeMockPublicKey(WALLET_A),
      signMessage: async () => {
        signCalled = true;
        return new Uint8Array(64);
      },
    }),
  });

  try {
    fillValidFields(mounted.container, WALLET_A);
    dom.submitForm(getForm(mounted.container));
    await mounted.flush(20);

    assert.equal(signCalled, false, 'Must not sign challenge missing campaignId');
    assert.equal(fx.calls.filter((c) => c.url.includes('/submit')).length, 0);
    assert.ok(mounted.container.textContent.includes('Challenge validation failed'));
  } finally {
    await mounted.unmount();
    fx.restore();
  }
});

test('Component [10/22]: Challenge response missing walletAddress is rejected', async () => {
  const fx = withMockFetch(({ url, method }) => {
    if (url === '/api/auth/session' && method === 'GET') {
      return jsonResponse({ authenticated: true, wallet: WALLET_A }, 200);
    }
    if (url.includes('/challenge') && method === 'POST') {
      return jsonResponse({
        ok: true,
        challengeId: 'rc_123456',
        message: 'TrenchLabs Raid Challenge|rc_123456',
        campaignId: 'camp-ux-test-1',
      }, 201);
    }
    return jsonResponse({}, 500);
  });

  let signCalled = false;
  const mounted = await mountCampaignCard({
    walletContext: makeMockWalletContext({
      connected: true,
      publicKey: makeMockPublicKey(WALLET_A),
      signMessage: async () => {
        signCalled = true;
        return new Uint8Array(64);
      },
    }),
  });

  try {
    fillValidFields(mounted.container, WALLET_A);
    dom.submitForm(getForm(mounted.container));
    await mounted.flush(20);

    assert.equal(signCalled, false);
    assert.equal(fx.calls.filter((c) => c.url.includes('/submit')).length, 0);
    assert.ok(mounted.container.textContent.includes('Challenge validation failed'));
  } finally {
    await mounted.unmount();
    fx.restore();
  }
});

test('Component [11/22]: Challenge response with mismatched campaignId is rejected', async () => {
  const fx = withMockFetch(({ url, method }) => {
    if (url === '/api/auth/session' && method === 'GET') {
      return jsonResponse({ authenticated: true, wallet: WALLET_A }, 200);
    }
    if (url.includes('/challenge') && method === 'POST') {
      return jsonResponse({
        ok: true,
        challengeId: 'rc_123456',
        message: 'TrenchLabs Raid Challenge|rc_123456',
        campaignId: 'camp-other-999',
        walletAddress: WALLET_A,
      }, 201);
    }
    return jsonResponse({}, 500);
  });

  const mounted = await mountCampaignCard({
    walletContext: makeMockWalletContext({
      connected: true,
      publicKey: makeMockPublicKey(WALLET_A),
      signMessage: async () => new Uint8Array(64),
    }),
  });

  try {
    fillValidFields(mounted.container, WALLET_A);
    dom.submitForm(getForm(mounted.container));
    await mounted.flush(20);

    assert.equal(fx.calls.filter((c) => c.url.includes('/submit')).length, 0);
    assert.ok(mounted.container.textContent.includes('Challenge validation failed'));
  } finally {
    await mounted.unmount();
    fx.restore();
  }
});

test('Component [12/22]: Challenge response with mismatched walletAddress is rejected', async () => {
  const fx = withMockFetch(({ url, method }) => {
    if (url === '/api/auth/session' && method === 'GET') {
      return jsonResponse({ authenticated: true, wallet: WALLET_A }, 200);
    }
    if (url.includes('/challenge') && method === 'POST') {
      return jsonResponse({
        ok: true,
        challengeId: 'rc_123456',
        message: 'TrenchLabs Raid Challenge|rc_123456',
        campaignId: 'camp-ux-test-1',
        walletAddress: WALLET_B,
      }, 201);
    }
    return jsonResponse({}, 500);
  });

  const mounted = await mountCampaignCard({
    walletContext: makeMockWalletContext({
      connected: true,
      publicKey: makeMockPublicKey(WALLET_A),
      signMessage: async () => new Uint8Array(64),
    }),
  });

  try {
    fillValidFields(mounted.container, WALLET_A);
    dom.submitForm(getForm(mounted.container));
    await mounted.flush(20);

    assert.equal(fx.calls.filter((c) => c.url.includes('/submit')).length, 0);
    assert.ok(mounted.container.textContent.includes('Challenge validation failed'));
  } finally {
    await mounted.unmount();
    fx.restore();
  }
});

test('Component [13/22]: Wallet changes while challenge request is pending aborts operation', async () => {
  const challengeDeferred = makeDeferred();
  const fx = withMockFetch(({ url, method }) => {
    if (url === '/api/auth/session' && method === 'GET') {
      return jsonResponse({ authenticated: true, wallet: WALLET_A }, 200);
    }
    if (url.includes('/challenge') && method === 'POST') {
      return challengeDeferred.promise;
    }
    return jsonResponse({}, 500);
  });

  let signCalled = false;
  const mounted = await mountCampaignCard({
    walletContext: makeMockWalletContext({
      connected: true,
      publicKey: makeMockPublicKey(WALLET_A),
      signMessage: async () => {
        signCalled = true;
        return new Uint8Array(64);
      },
    }),
  });

  try {
    fillValidFields(mounted.container, WALLET_A);
    dom.submitForm(getForm(mounted.container));
    await mounted.flush(20);

    // Switch wallet while challenge request is pending
    await mounted.update({
      walletContext: makeMockWalletContext({
        connected: true,
        publicKey: makeMockPublicKey(WALLET_B),
        signMessage: async () => new Uint8Array(64),
      }),
    });

    challengeDeferred.resolve(
      jsonResponse({
        ok: true,
        challengeId: 'rc_123456',
        message: 'msg',
        campaignId: 'camp-ux-test-1',
        walletAddress: WALLET_A,
      }, 201)
    );
    await mounted.flush(20);

    assert.equal(signCalled, false);
    assert.equal(fx.calls.filter((c) => c.url.includes('/submit')).length, 0);
  } finally {
    await mounted.unmount();
    fx.restore();
  }
});

test('Component [14/22]: Wallet changes during challenge signing aborts operation', async () => {
  const signDeferred = makeDeferred();
  const fx = withMockFetch(({ url, method }) => {
    if (url === '/api/auth/session' && method === 'GET') {
      return jsonResponse({ authenticated: true, wallet: WALLET_A }, 200);
    }
    if (url.includes('/challenge') && method === 'POST') {
      return jsonResponse({
        ok: true,
        challengeId: 'rc_123456',
        message: 'msg',
        campaignId: 'camp-ux-test-1',
        walletAddress: WALLET_A,
      }, 201);
    }
    return jsonResponse({}, 500);
  });

  const mounted = await mountCampaignCard({
    walletContext: makeMockWalletContext({
      connected: true,
      publicKey: makeMockPublicKey(WALLET_A),
      signMessage: () => signDeferred.promise,
    }),
  });

  try {
    fillValidFields(mounted.container, WALLET_A);
    dom.submitForm(getForm(mounted.container));
    await mounted.flush(20);

    // Switch wallet while challenge signing is pending
    await mounted.update({
      walletContext: makeMockWalletContext({
        connected: true,
        publicKey: makeMockPublicKey(WALLET_B),
        signMessage: async () => new Uint8Array(64),
      }),
    });

    signDeferred.resolve(new Uint8Array(64).fill(3));
    await mounted.flush(20);

    assert.equal(fx.calls.filter((c) => c.url.includes('/submit')).length, 0);
  } finally {
    await mounted.unmount();
    fx.restore();
  }
});

test('Component [15/22]: Wallet disconnects immediately before submission -> submit endpoint not called', async () => {
  const signDeferred = makeDeferred();
  const fx = withMockFetch(({ url, method }) => {
    if (url === '/api/auth/session' && method === 'GET') {
      return jsonResponse({ authenticated: true, wallet: WALLET_A }, 200);
    }
    if (url.includes('/challenge') && method === 'POST') {
      return jsonResponse({
        ok: true,
        challengeId: 'rc_123456',
        message: 'msg',
        campaignId: 'camp-ux-test-1',
        walletAddress: WALLET_A,
      }, 201);
    }
    return jsonResponse({}, 500);
  });

  const mounted = await mountCampaignCard({
    walletContext: makeMockWalletContext({
      connected: true,
      publicKey: makeMockPublicKey(WALLET_A),
      signMessage: () => signDeferred.promise,
    }),
  });

  try {
    fillValidFields(mounted.container, WALLET_A);
    dom.submitForm(getForm(mounted.container));
    await mounted.flush(20);

    // Disconnect wallet right before signing resolves -> before submission POST
    await mounted.update({
      walletContext: makeMockWalletContext({
        connected: false,
        publicKey: null,
        wallet: null,
      }),
    });

    signDeferred.resolve(new Uint8Array(64).fill(4));
    await mounted.flush(20);

    assert.equal(fx.calls.filter((c) => c.url.includes('/submit')).length, 0);
  } finally {
    await mounted.unmount();
    fx.restore();
  }
});

test('Component [16/22]: Adapter changes before submission -> submit endpoint not called', async () => {
  const signDeferred = makeDeferred();
  const adapter1 = {
    name: 'Phantom',
    connected: true,
    publicKey: makeMockPublicKey(WALLET_A),
  };
  const adapter2 = {
    name: 'Solflare',
    connected: true,
    publicKey: makeMockPublicKey(WALLET_A),
  };

  const fx = withMockFetch(({ url, method }) => {
    if (url === '/api/auth/session' && method === 'GET') {
      return jsonResponse({ authenticated: true, wallet: WALLET_A }, 200);
    }
    if (url.includes('/challenge') && method === 'POST') {
      return jsonResponse({
        ok: true,
        challengeId: 'rc_123456',
        message: 'msg',
        campaignId: 'camp-ux-test-1',
        walletAddress: WALLET_A,
      }, 201);
    }
    return jsonResponse({}, 500);
  });

  const mounted = await mountCampaignCard({
    walletContext: makeMockWalletContext({
      connected: true,
      publicKey: makeMockPublicKey(WALLET_A),
      adapterInstance: adapter1,
      signMessage: () => signDeferred.promise,
    }),
  });

  try {
    fillValidFields(mounted.container, WALLET_A);
    dom.submitForm(getForm(mounted.container));
    await mounted.flush(20);

    // Swap adapter instance (same wallet address, different adapter object)
    await mounted.update({
      walletContext: makeMockWalletContext({
        connected: true,
        publicKey: makeMockPublicKey(WALLET_A),
        adapterInstance: adapter2,
        signMessage: async () => new Uint8Array(64),
      }),
    });

    signDeferred.resolve(new Uint8Array(64).fill(5));
    await mounted.flush(20);

    assert.equal(fx.calls.filter((c) => c.url.includes('/submit')).length, 0);
  } finally {
    await mounted.unmount();
    fx.restore();
  }
});

test('Component [17/22]: User cancels signing -> no submission POST occurs', async () => {
  const fx = withMockFetch(({ url, method }) => {
    if (url === '/api/auth/session' && method === 'GET') {
      return jsonResponse({ authenticated: true, wallet: WALLET_A }, 200);
    }
    if (url.includes('/challenge') && method === 'POST') {
      return jsonResponse({
        ok: true,
        challengeId: 'rc_123456',
        message: 'msg',
        campaignId: 'camp-ux-test-1',
        walletAddress: WALLET_A,
      }, 201);
    }
    return jsonResponse({}, 500);
  });

  const mounted = await mountCampaignCard({
    walletContext: makeMockWalletContext({
      connected: true,
      publicKey: makeMockPublicKey(WALLET_A),
      signMessage: async () => {
        throw new Error('User rejected the request.');
      },
    }),
  });

  try {
    fillValidFields(mounted.container, WALLET_A);
    dom.submitForm(getForm(mounted.container));
    await mounted.flush(20);

    assert.equal(fx.calls.filter((c) => c.url.includes('/submit')).length, 0);
    assert.ok(mounted.container.textContent.includes('Challenge signature rejected'));
  } finally {
    await mounted.unmount();
    fx.restore();
  }
});

test('Component [18/22]: Two rapid submit clicks start only one operation', async () => {
  const challengeDeferred = makeDeferred();
  const fx = withMockFetch(({ url, method }) => {
    if (url === '/api/auth/session' && method === 'GET') {
      return jsonResponse({ authenticated: true, wallet: WALLET_A }, 200);
    }
    if (url.includes('/challenge') && method === 'POST') {
      return challengeDeferred.promise;
    }
    if (url.includes('/submit') && method === 'POST') {
      return jsonResponse({
        ok: true,
        submission: {
          id: 'sub-1',
          campaignId: 'camp-ux-test-1',
          walletAddress: WALLET_A,
          xHandle: '@raider_hero',
          xRetweetLink: 'https://x.com/raider_hero/status/1850000000000000999',
          status: 'PENDING',
          submittedAt: new Date().toISOString(),
        },
      }, 201);
    }
    return jsonResponse({}, 500);
  });

  const mounted = await mountCampaignCard({
    walletContext: makeMockWalletContext({
      connected: true,
      publicKey: makeMockPublicKey(WALLET_A),
      signMessage: async () => new Uint8Array(64).fill(6),
    }),
  });

  try {
    fillValidFields(mounted.container, WALLET_A);
    const form = getForm(mounted.container);
    // Fire two rapid submits synchronously before React re-renders
    dom.submitForm(form);
    dom.submitForm(form);
    await mounted.flush(20);

    assert.equal(
      fx.calls.filter((c) => c.url.includes('/challenge')).length,
      1,
      'Only one challenge request must be issued for rapid double-submit'
    );

    challengeDeferred.resolve(
      jsonResponse({
        ok: true,
        challengeId: 'rc_rapid_1',
        message: 'msg',
        campaignId: 'camp-ux-test-1',
        walletAddress: WALLET_A,
      }, 201)
    );
    await mounted.flush(25);

    assert.equal(fx.calls.filter((c) => c.url.includes('/submit')).length, 1);
  } finally {
    await mounted.unmount();
    fx.restore();
  }
});

test('Component [19/22]: Backend rejects submission -> no success state appears', async () => {
  const fx = withMockFetch(({ url, method }) => {
    if (url === '/api/auth/session' && method === 'GET') {
      return jsonResponse({ authenticated: true, wallet: WALLET_A }, 200);
    }
    if (url.includes('/challenge') && method === 'POST') {
      return jsonResponse({
        ok: true,
        challengeId: 'rc_reject_1',
        message: 'msg',
        campaignId: 'camp-ux-test-1',
        walletAddress: WALLET_A,
      }, 201);
    }
    if (url.includes('/submit') && method === 'POST') {
      return jsonResponse({ ok: false, error: 'Wallet already submitted for this campaign' }, 400);
    }
    return jsonResponse({}, 500);
  });

  const mounted = await mountCampaignCard({
    walletContext: makeMockWalletContext({
      connected: true,
      publicKey: makeMockPublicKey(WALLET_A),
      signMessage: async () => new Uint8Array(64).fill(7),
    }),
  });

  try {
    fillValidFields(mounted.container, WALLET_A);
    dom.submitForm(getForm(mounted.container));
    await mounted.flush(25);

    assert.ok(!mounted.container.textContent.includes('Raid Proof Submitted'));
    assert.ok(mounted.container.textContent.includes('Wallet already submitted'));
  } finally {
    await mounted.unmount();
    fx.restore();
  }
});

test('Component [20/22]: Valid complete flow shows success only after successful backend response', async () => {
  const submitDeferred = makeDeferred();
  let callbackSubmission = null;
  const fx = withMockFetch(({ url, method }) => {
    if (url === '/api/auth/session' && method === 'GET') {
      return jsonResponse({ authenticated: true, wallet: WALLET_A }, 200);
    }
    if (url.includes('/challenge') && method === 'POST') {
      return jsonResponse({
        ok: true,
        challengeId: 'rc_ok_1',
        message: 'TrenchLabs Raid Challenge|rc_ok_1',
        campaignId: 'camp-ux-test-1',
        walletAddress: WALLET_A,
      }, 201);
    }
    if (url.includes('/submit') && method === 'POST') {
      return submitDeferred.promise;
    }
    return jsonResponse({}, 500);
  });

  const mounted = await mountCampaignCard({
    campaign: makeSampleCampaign(),
    walletContext: makeMockWalletContext({
      connected: true,
      publicKey: makeMockPublicKey(WALLET_A),
      signMessage: async () => new Uint8Array(64).fill(8),
    }),
    onSubmissionSuccess: (sub) => {
      callbackSubmission = sub;
    },
  });

  try {
    fillValidFields(mounted.container, WALLET_A);
    dom.submitForm(getForm(mounted.container));
    await mounted.flush(20);

    // Before backend resolves, success state must NOT appear
    assert.ok(!mounted.container.textContent.includes('Raid Proof Submitted'));
    assert.equal(callbackSubmission, null);

    submitDeferred.resolve(
      jsonResponse({
        ok: true,
        submission: {
          id: 'sub-ok-1',
          campaignId: 'camp-ux-test-1',
          walletAddress: WALLET_A,
          xHandle: '@raider_hero',
          xRetweetLink: 'https://x.com/raider_hero/status/1850000000000000999',
          status: 'PENDING',
          submittedAt: new Date().toISOString(),
        },
      }, 201)
    );
    await mounted.flush(25);

    assert.ok(mounted.container.textContent.includes('Raid Proof Submitted'));
    assert.equal(callbackSubmission?.id, 'sub-ok-1');
  } finally {
    await mounted.unmount();
    fx.restore();
  }
});

test('Component [21/22]: Retry after cancellation requests a fresh challenge', async () => {
  let signAttempt = 0;
  let challengeSeq = 0;
  const fx = withMockFetch(({ url, method }) => {
    if (url === '/api/auth/session' && method === 'GET') {
      return jsonResponse({ authenticated: true, wallet: WALLET_A }, 200);
    }
    if (url.includes('/challenge') && method === 'POST') {
      challengeSeq += 1;
      return jsonResponse({
        ok: true,
        challengeId: `rc_retry_cancel_${challengeSeq}`,
        message: `msg_${challengeSeq}`,
        campaignId: 'camp-ux-test-1',
        walletAddress: WALLET_A,
      }, 201);
    }
    if (url.includes('/submit') && method === 'POST') {
      return jsonResponse({
        ok: true,
        submission: {
          id: 'sub-retry-1',
          campaignId: 'camp-ux-test-1',
          walletAddress: WALLET_A,
          xHandle: '@raider_hero',
          xRetweetLink: 'https://x.com/raider_hero/status/1850000000000000999',
          status: 'PENDING',
          submittedAt: new Date().toISOString(),
        },
      }, 201);
    }
    return jsonResponse({}, 500);
  });

  const mounted = await mountCampaignCard({
    walletContext: makeMockWalletContext({
      connected: true,
      publicKey: makeMockPublicKey(WALLET_A),
      signMessage: async () => {
        signAttempt += 1;
        if (signAttempt === 1) {
          throw new Error('User rejected the request.');
        }
        return new Uint8Array(64).fill(9);
      },
    }),
  });

  try {
    fillValidFields(mounted.container, WALLET_A);
    // Attempt 1: cancelled
    dom.submitForm(getForm(mounted.container));
    await mounted.flush(20);
    assert.equal(fx.calls.filter((c) => c.url.includes('/challenge')).length, 1);
    assert.equal(fx.calls.filter((c) => c.url.includes('/submit')).length, 0);

    // Attempt 2: retry must request a fresh challenge
    dom.submitForm(getForm(mounted.container));
    await mounted.flush(25);
    assert.equal(fx.calls.filter((c) => c.url.includes('/challenge')).length, 2);
    const submitCalls = fx.calls.filter((c) => c.url.includes('/submit'));
    assert.equal(submitCalls.length, 1);
    assert.equal(submitCalls[0].body.challengeId, 'rc_retry_cancel_2');
    assert.ok(mounted.container.textContent.includes('Raid Proof Submitted'));
  } finally {
    await mounted.unmount();
    fx.restore();
  }
});

test('Component [22/22]: Retry after challenge failure requests a fresh challenge', async () => {
  let challengeSeq = 0;
  const fx = withMockFetch(({ url, method }) => {
    if (url === '/api/auth/session' && method === 'GET') {
      return jsonResponse({ authenticated: true, wallet: WALLET_A }, 200);
    }
    if (url.includes('/challenge') && method === 'POST') {
      challengeSeq += 1;
      if (challengeSeq === 1) {
        return jsonResponse({ ok: false, error: 'Storage temporarily unavailable' }, 503);
      }
      return jsonResponse({
        ok: true,
        challengeId: `rc_retry_fail_${challengeSeq}`,
        message: `msg_${challengeSeq}`,
        campaignId: 'camp-ux-test-1',
        walletAddress: WALLET_A,
      }, 201);
    }
    if (url.includes('/submit') && method === 'POST') {
      return jsonResponse({
        ok: true,
        submission: {
          id: 'sub-retry-2',
          campaignId: 'camp-ux-test-1',
          walletAddress: WALLET_A,
          xHandle: '@raider_hero',
          xRetweetLink: 'https://x.com/raider_hero/status/1850000000000000999',
          status: 'PENDING',
          submittedAt: new Date().toISOString(),
        },
      }, 201);
    }
    return jsonResponse({}, 500);
  });

  const mounted = await mountCampaignCard({
    walletContext: makeMockWalletContext({
      connected: true,
      publicKey: makeMockPublicKey(WALLET_A),
      signMessage: async () => new Uint8Array(64).fill(10),
    }),
  });

  try {
    fillValidFields(mounted.container, WALLET_A);
    // Attempt 1: challenge endpoint fails 503
    dom.submitForm(getForm(mounted.container));
    await mounted.flush(20);
    assert.ok(mounted.container.textContent.includes('Storage temporarily unavailable'));
    assert.equal(fx.calls.filter((c) => c.url.includes('/submit')).length, 0);

    // Attempt 2: retry requests a fresh challenge and succeeds
    dom.submitForm(getForm(mounted.container));
    await mounted.flush(25);
    assert.equal(fx.calls.filter((c) => c.url.includes('/challenge')).length, 2);
    const submitCalls = fx.calls.filter((c) => c.url.includes('/submit'));
    assert.equal(submitCalls.length, 1);
    assert.equal(submitCalls[0].body.challengeId, 'rc_retry_fail_2');
    assert.ok(mounted.container.textContent.includes('Raid Proof Submitted'));
  } finally {
    await mounted.unmount();
    fx.restore();
  }
});

// ============================================================================
// V1.2 COMPONENT INTERACTION TESTS (Section 5: 10 Scenarios)
// ============================================================================

const EXPECTED_WALLET_CHANGED_WARNING =
  'Your submission was accepted for the original wallet, but your connected wallet changed before confirmation.';

test('V1.2 [1/10]: Wallet changes while submission POST is pending and server returns success', async () => {
  const submitDeferred = makeDeferred();
  let onSuccessCalls = 0;

  const fx = withMockFetch(({ url, method }) => {
    if (url === '/api/auth/session' && method === 'GET') {
      return jsonResponse({ authenticated: true, wallet: WALLET_A }, 200);
    }
    if (url.includes('/challenge') && method === 'POST') {
      return jsonResponse({
        ok: true,
        challengeId: 'rc_v12_1',
        message: 'msg_v12_1',
        campaignId: 'camp-ux-test-1',
        walletAddress: WALLET_A,
      }, 201);
    }
    if (url.includes('/submit') && method === 'POST') {
      return submitDeferred.promise;
    }
    return jsonResponse({}, 500);
  });

  const mounted = await mountCampaignCard({
    walletContext: makeMockWalletContext({
      connected: true,
      publicKey: makeMockPublicKey(WALLET_A),
      signMessage: async () => new Uint8Array(64).fill(1),
    }),
    onSubmissionSuccess: () => {
      onSuccessCalls += 1;
    },
  });

  try {
    fillValidFields(mounted.container, WALLET_A);
    dom.submitForm(getForm(mounted.container));
    await mounted.flush(20);
    assert.equal(fx.calls.filter((c) => c.url.includes('/submit')).length, 1);

    // Switch to WALLET_B while POST /submit is pending
    await mounted.update({
      walletContext: makeMockWalletContext({
        connected: true,
        publicKey: makeMockPublicKey(WALLET_B),
        signMessage: async () => new Uint8Array(64).fill(2),
      }),
    });

    // Server accepts original WALLET_A submission
    submitDeferred.resolve(
      jsonResponse({
        ok: true,
        submission: {
          id: 'sub-v12-1',
          campaignId: 'camp-ux-test-1',
          walletAddress: WALLET_A,
          xHandle: '@raider_hero',
          xRetweetLink: 'https://x.com/raider_hero/status/1850000000000000999',
          status: 'PENDING',
          submittedAt: new Date().toISOString(),
        },
      }, 201)
    );
    await mounted.flush(25);

    assert.equal(onSuccessCalls, 0, 'Must not call onSubmissionSuccess for new wallet');
    assert.equal(fx.calls.filter((c) => c.url.includes('/submit')).length, 1, 'Must not auto-resubmit');
    assert.ok(!mounted.container.textContent.includes('Raid Proof Submitted'));
    assert.ok(mounted.container.textContent.includes(EXPECTED_WALLET_CHANGED_WARNING));
  } finally {
    await mounted.unmount();
    fx.restore();
  }
});

test('V1.2 [2/10]: Wallet disconnects while submission POST is pending and server returns success', async () => {
  const submitDeferred = makeDeferred();
  let onSuccessCalls = 0;

  const fx = withMockFetch(({ url, method }) => {
    if (url === '/api/auth/session' && method === 'GET') {
      return jsonResponse({ authenticated: true, wallet: WALLET_A }, 200);
    }
    if (url.includes('/challenge') && method === 'POST') {
      return jsonResponse({
        ok: true,
        challengeId: 'rc_v12_2',
        message: 'msg_v12_2',
        campaignId: 'camp-ux-test-1',
        walletAddress: WALLET_A,
      }, 201);
    }
    if (url.includes('/submit') && method === 'POST') {
      return submitDeferred.promise;
    }
    return jsonResponse({}, 500);
  });

  const mounted = await mountCampaignCard({
    walletContext: makeMockWalletContext({
      connected: true,
      publicKey: makeMockPublicKey(WALLET_A),
      signMessage: async () => new Uint8Array(64).fill(1),
    }),
    onSubmissionSuccess: () => {
      onSuccessCalls += 1;
    },
  });

  try {
    fillValidFields(mounted.container, WALLET_A);
    dom.submitForm(getForm(mounted.container));
    await mounted.flush(20);
    assert.equal(fx.calls.filter((c) => c.url.includes('/submit')).length, 1);

    // Disconnect wallet while POST /submit is pending
    await mounted.update({
      walletContext: makeMockWalletContext({
        connected: false,
        publicKey: null,
        adapterConnected: false,
        adapterPublicKey: null,
      }),
    });

    submitDeferred.resolve(
      jsonResponse({
        ok: true,
        submission: {
          id: 'sub-v12-2',
          campaignId: 'camp-ux-test-1',
          walletAddress: WALLET_A,
          xHandle: '@raider_hero',
          xRetweetLink: 'https://x.com/raider_hero/status/1850000000000000999',
          status: 'PENDING',
          submittedAt: new Date().toISOString(),
        },
      }, 201)
    );
    await mounted.flush(25);

    assert.equal(onSuccessCalls, 0);
    assert.equal(fx.calls.filter((c) => c.url.includes('/submit')).length, 1);
    assert.ok(!mounted.container.textContent.includes('Raid Proof Submitted'));
    assert.ok(mounted.container.textContent.includes(EXPECTED_WALLET_CHANGED_WARNING));
  } finally {
    await mounted.unmount();
    fx.restore();
  }
});

test('V1.2 [3/10]: Adapter changes while submission POST is pending but public key remains the same', async () => {
  const submitDeferred = makeDeferred();
  let onSuccessCalls = 0;

  const fx = withMockFetch(({ url, method }) => {
    if (url === '/api/auth/session' && method === 'GET') {
      return jsonResponse({ authenticated: true, wallet: WALLET_A }, 200);
    }
    if (url.includes('/challenge') && method === 'POST') {
      return jsonResponse({
        ok: true,
        challengeId: 'rc_v12_3',
        message: 'msg_v12_3',
        campaignId: 'camp-ux-test-1',
        walletAddress: WALLET_A,
      }, 201);
    }
    if (url.includes('/submit') && method === 'POST') {
      return submitDeferred.promise;
    }
    return jsonResponse({}, 500);
  });

  const adapter1 = {
    name: 'Phantom',
    connected: true,
    publicKey: makeMockPublicKey(WALLET_A),
  };
  const adapter2 = {
    name: 'Solflare',
    connected: true,
    publicKey: makeMockPublicKey(WALLET_A),
  };

  const mounted = await mountCampaignCard({
    walletContext: makeMockWalletContext({
      connected: true,
      publicKey: makeMockPublicKey(WALLET_A),
      adapterInstance: adapter1,
      signMessage: async () => new Uint8Array(64).fill(1),
    }),
    onSubmissionSuccess: () => {
      onSuccessCalls += 1;
    },
  });

  try {
    fillValidFields(mounted.container, WALLET_A);
    dom.submitForm(getForm(mounted.container));
    await mounted.flush(20);
    assert.equal(fx.calls.filter((c) => c.url.includes('/submit')).length, 1);

    // Replace adapter instance while keeping same WALLET_A public key
    await mounted.update({
      walletContext: makeMockWalletContext({
        connected: true,
        publicKey: makeMockPublicKey(WALLET_A),
        adapterInstance: adapter2,
        signMessage: async () => new Uint8Array(64).fill(1),
      }),
    });

    submitDeferred.resolve(
      jsonResponse({
        ok: true,
        submission: {
          id: 'sub-v12-3',
          campaignId: 'camp-ux-test-1',
          walletAddress: WALLET_A,
          xHandle: '@raider_hero',
          xRetweetLink: 'https://x.com/raider_hero/status/1850000000000000999',
          status: 'PENDING',
          submittedAt: new Date().toISOString(),
        },
      }, 201)
    );
    await mounted.flush(25);

    assert.equal(onSuccessCalls, 0);
    assert.equal(fx.calls.filter((c) => c.url.includes('/submit')).length, 1);
    assert.ok(!mounted.container.textContent.includes('Raid Proof Submitted'));
    assert.ok(mounted.container.textContent.includes(EXPECTED_WALLET_CHANGED_WARNING));
  } finally {
    await mounted.unmount();
    fx.restore();
  }
});

test('V1.2 [4/10]: Wallet changes immediately after HTTP response but before JSON parsing completes', async () => {
  const jsonDeferred = makeDeferred();
  let onSuccessCalls = 0;

  const fx = withMockFetch(({ url, method }) => {
    if (url === '/api/auth/session' && method === 'GET') {
      return jsonResponse({ authenticated: true, wallet: WALLET_A }, 200);
    }
    if (url.includes('/challenge') && method === 'POST') {
      return jsonResponse({
        ok: true,
        challengeId: 'rc_v12_4',
        message: 'msg_v12_4',
        campaignId: 'camp-ux-test-1',
        walletAddress: WALLET_A,
      }, 201);
    }
    if (url.includes('/submit') && method === 'POST') {
      return {
        ok: true,
        status: 201,
        json: () => jsonDeferred.promise,
      };
    }
    return jsonResponse({}, 500);
  });

  const mounted = await mountCampaignCard({
    walletContext: makeMockWalletContext({
      connected: true,
      publicKey: makeMockPublicKey(WALLET_A),
      signMessage: async () => new Uint8Array(64).fill(1),
    }),
    onSubmissionSuccess: () => {
      onSuccessCalls += 1;
    },
  });

  try {
    fillValidFields(mounted.container, WALLET_A);
    dom.submitForm(getForm(mounted.container));
    await mounted.flush(20);
    assert.equal(fx.calls.filter((c) => c.url.includes('/submit')).length, 1);

    // HTTP response has arrived (Checkpoint 12 passed), now res.json() is pending -> switch wallet
    await mounted.update({
      walletContext: makeMockWalletContext({
        connected: true,
        publicKey: makeMockPublicKey(WALLET_B),
        signMessage: async () => new Uint8Array(64).fill(2),
      }),
    });

    // Complete JSON parsing after wallet switched
    jsonDeferred.resolve({
      ok: true,
      submission: {
        id: 'sub-v12-4',
        campaignId: 'camp-ux-test-1',
        walletAddress: WALLET_A,
        xHandle: '@raider_hero',
        xRetweetLink: 'https://x.com/raider_hero/status/1850000000000000999',
        status: 'PENDING',
        submittedAt: new Date().toISOString(),
      },
    });
    await mounted.flush(25);

    assert.equal(onSuccessCalls, 0);
    assert.equal(fx.calls.filter((c) => c.url.includes('/submit')).length, 1);
    assert.ok(!mounted.container.textContent.includes('Raid Proof Submitted'));
    assert.ok(mounted.container.textContent.includes(EXPECTED_WALLET_CHANGED_WARNING));
  } finally {
    await mounted.unmount();
    fx.restore();
  }
});

test('V1.2 [5/10]: Wallet remains unchanged through response parsing and successful submission is displayed normally', async () => {
  const submitDeferred = makeDeferred();
  const jsonDeferred = makeDeferred();
  let deliveredSubmission = null;

  const fx = withMockFetch(({ url, method }) => {
    if (url === '/api/auth/session' && method === 'GET') {
      return jsonResponse({ authenticated: true, wallet: WALLET_A }, 200);
    }
    if (url.includes('/challenge') && method === 'POST') {
      return jsonResponse({
        ok: true,
        challengeId: 'rc_v12_5',
        message: 'msg_v12_5',
        campaignId: 'camp-ux-test-1',
        walletAddress: WALLET_A,
      }, 201);
    }
    if (url.includes('/submit') && method === 'POST') {
      return submitDeferred.promise;
    }
    return jsonResponse({}, 500);
  });

  const mounted = await mountCampaignCard({
    walletContext: makeMockWalletContext({
      connected: true,
      publicKey: makeMockPublicKey(WALLET_A),
      signMessage: async () => new Uint8Array(64).fill(1),
    }),
    onSubmissionSuccess: (sub) => {
      deliveredSubmission = sub;
    },
  });

  try {
    fillValidFields(mounted.container, WALLET_A);
    dom.submitForm(getForm(mounted.container));
    await mounted.flush(20);

    submitDeferred.resolve({
      ok: true,
      status: 201,
      json: () => jsonDeferred.promise,
    });
    await mounted.flush(10);
    assert.ok(!mounted.container.textContent.includes('Raid Proof Submitted'));

    jsonDeferred.resolve({
      ok: true,
      submission: {
        id: 'sub-v12-5',
        campaignId: 'camp-ux-test-1',
        walletAddress: WALLET_A,
        xHandle: '@raider_hero',
        xRetweetLink: 'https://x.com/raider_hero/status/1850000000000000999',
        status: 'PENDING',
        submittedAt: new Date().toISOString(),
      },
    });
    await mounted.flush(25);

    assert.ok(mounted.container.textContent.includes('Raid Proof Submitted'));
    assert.equal(deliveredSubmission?.id, 'sub-v12-5');
    assert.equal(deliveredSubmission?.walletAddress, WALLET_A);
  } finally {
    await mounted.unmount();
    fx.restore();
  }
});

test('V1.2 [6/10]: Stale response cannot overwrite a newer wallet UI state', async () => {
  const walletASubmitDeferred = makeDeferred();
  let currentWalletSession = WALLET_A;
  const deliveredIds = [];

  const fx = withMockFetch(({ url, method, body }) => {
    if (url === '/api/auth/session' && method === 'GET') {
      return jsonResponse({ authenticated: true, wallet: currentWalletSession }, 200);
    }
    if (url.includes('/challenge') && method === 'POST') {
      return jsonResponse({
        ok: true,
        challengeId: `rc_${body.walletAddress === WALLET_A ? 'A' : 'B'}`,
        message: 'msg',
        campaignId: 'camp-ux-test-1',
        walletAddress: body.walletAddress,
      }, 201);
    }
    if (url.includes('/submit') && method === 'POST') {
      if (body.walletAddress === WALLET_A) {
        return walletASubmitDeferred.promise;
      }
      return jsonResponse({
        ok: true,
        submission: {
          id: 'sub-wallet-B',
          campaignId: 'camp-ux-test-1',
          walletAddress: WALLET_B,
          xHandle: '@raider_hero',
          xRetweetLink: 'https://x.com/raider_hero/status/1850000000000000999',
          status: 'PENDING',
          submittedAt: new Date().toISOString(),
        },
      }, 201);
    }
    return jsonResponse({}, 500);
  });

  const mounted = await mountCampaignCard({
    walletContext: makeMockWalletContext({
      connected: true,
      publicKey: makeMockPublicKey(WALLET_A),
      signMessage: async () => new Uint8Array(64).fill(1),
    }),
    onSubmissionSuccess: (sub) => {
      deliveredIds.push(sub.id);
    },
  });

  try {
    fillValidFields(mounted.container, WALLET_A);
    dom.submitForm(getForm(mounted.container));
    await mounted.flush(20);

    // Switch to WALLET_B and submit cleanly for WALLET_B
    currentWalletSession = WALLET_B;
    await mounted.update({
      walletContext: makeMockWalletContext({
        connected: true,
        publicKey: makeMockPublicKey(WALLET_B),
        signMessage: async () => new Uint8Array(64).fill(2),
      }),
    });
    fillValidFields(mounted.container, WALLET_B);
    dom.submitForm(getForm(mounted.container));
    await mounted.flush(25);

    assert.ok(mounted.container.textContent.includes('Raid Proof Submitted'));
    assert.deepEqual(deliveredIds, ['sub-wallet-B']);

    // Now WALLET_A's stale POST resolves with an error or success -> must NOT overwrite WALLET_B's UI state
    walletASubmitDeferred.resolve(
      jsonResponse({ ok: false, error: 'Stale wallet A error' }, 400)
    );
    await mounted.flush(25);

    assert.ok(mounted.container.textContent.includes('Raid Proof Submitted'));
    assert.ok(!mounted.container.textContent.includes('Stale wallet A error'));
    assert.ok(!mounted.container.textContent.includes(EXPECTED_WALLET_CHANGED_WARNING));
    assert.deepEqual(deliveredIds, ['sub-wallet-B']);
  } finally {
    await mounted.unmount();
    fx.restore();
  }
});

test('V1.2 [7/10]: Stale attempt finally block cannot release a newer attempt in-flight guard', async () => {
  const walletASubmitDeferred = makeDeferred();
  const walletBChallengeDeferred = makeDeferred();
  let currentWalletSession = WALLET_A;

  const fx = withMockFetch(({ url, method, body }) => {
    if (url === '/api/auth/session' && method === 'GET') {
      return jsonResponse({ authenticated: true, wallet: currentWalletSession }, 200);
    }
    if (url.includes('/challenge') && method === 'POST') {
      if (body.walletAddress === WALLET_A) {
        return jsonResponse({
          ok: true,
          challengeId: 'rc_A_finally',
          message: 'msg_A',
          campaignId: 'camp-ux-test-1',
          walletAddress: WALLET_A,
        }, 201);
      }
      return walletBChallengeDeferred.promise;
    }
    if (url.includes('/submit') && method === 'POST') {
      return walletASubmitDeferred.promise;
    }
    return jsonResponse({}, 500);
  });

  const mounted = await mountCampaignCard({
    walletContext: makeMockWalletContext({
      connected: true,
      publicKey: makeMockPublicKey(WALLET_A),
      signMessage: async () => new Uint8Array(64).fill(1),
    }),
  });

  try {
    fillValidFields(mounted.container, WALLET_A);
    dom.submitForm(getForm(mounted.container));
    await mounted.flush(20);

    // Switch to WALLET_B and start a new submission (pending at /challenge)
    currentWalletSession = WALLET_B;
    await mounted.update({
      walletContext: makeMockWalletContext({
        connected: true,
        publicKey: makeMockPublicKey(WALLET_B),
        signMessage: async () => new Uint8Array(64).fill(2),
      }),
    });
    fillValidFields(mounted.container, WALLET_B);
    dom.submitForm(getForm(mounted.container));
    await mounted.flush(20);

    const challengesBeforeStaleFinish = fx.calls.filter(
      (c) => c.url.includes('/challenge') && c.body?.walletAddress === WALLET_B
    ).length;
    assert.equal(challengesBeforeStaleFinish, 1);

    // Stale WALLET_A attempt finishes & runs its finally block
    walletASubmitDeferred.resolve(jsonResponse({ ok: false, error: 'Stale error' }, 500));
    await mounted.flush(20);

    // Attempt a duplicate click for WALLET_B while WALLET_B's challenge is still pending:
    // Must still be blocked by WALLET_B's in-flight guard!
    dom.submitForm(getForm(mounted.container));
    await mounted.flush(20);

    const challengesAfterStaleFinish = fx.calls.filter(
      (c) => c.url.includes('/challenge') && c.body?.walletAddress === WALLET_B
    ).length;
    assert.equal(
      challengesAfterStaleFinish,
      1,
      'Stale attempt finally must not release newer attempt in-flight guard'
    );

    // Cleanly resolve WALLET_B challenge
    walletBChallengeDeferred.resolve(jsonResponse({ ok: false, error: 'Done' }, 400));
    await mounted.flush(20);
  } finally {
    await mounted.unmount();
    fx.restore();
  }
});

test('V1.2 [8/10]: Wallet snapshot is updated at commit phase before async callbacks continue', async () => {
  const challengeDeferred = makeDeferred();
  let signCalled = false;

  const fx = withMockFetch(({ url, method }) => {
    if (url === '/api/auth/session' && method === 'GET') {
      return jsonResponse({ authenticated: true, wallet: WALLET_A }, 200);
    }
    if (url.includes('/challenge') && method === 'POST') {
      return challengeDeferred.promise;
    }
    return jsonResponse({}, 500);
  });

  const mounted = await mountCampaignCard({
    walletContext: makeMockWalletContext({
      connected: true,
      publicKey: makeMockPublicKey(WALLET_A),
      signMessage: async () => {
        signCalled = true;
        return new Uint8Array(64).fill(1);
      },
    }),
  });

  try {
    fillValidFields(mounted.container, WALLET_A);
    dom.submitForm(getForm(mounted.container));
    await mounted.flush(20);

    // Update wallet and immediately resolve challenge in the same tick after commit
    await mounted.update({
      walletContext: makeMockWalletContext({
        connected: true,
        publicKey: makeMockPublicKey(WALLET_B),
        signMessage: async () => {
          signCalled = true;
          return new Uint8Array(64).fill(2);
        },
      }),
    });

    challengeDeferred.resolve(
      jsonResponse({
        ok: true,
        challengeId: 'rc_v12_8',
        message: 'msg_v12_8',
        campaignId: 'camp-ux-test-1',
        walletAddress: WALLET_A,
      }, 201)
    );
    await mounted.flush(20);

    assert.equal(signCalled, false, 'Commit-phase snapshot update must invalidate challenge callback');
    assert.equal(fx.calls.filter((c) => c.url.includes('/submit')).length, 0);
  } finally {
    await mounted.unmount();
    fx.restore();
  }
});

test('V1.2 [9/10]: Wallet changes immediately before deferred async response resolves', async () => {
  const submitDeferred = makeDeferred();
  let onSuccessCalls = 0;

  const fx = withMockFetch(({ url, method }) => {
    if (url === '/api/auth/session' && method === 'GET') {
      return jsonResponse({ authenticated: true, wallet: WALLET_A }, 200);
    }
    if (url.includes('/challenge') && method === 'POST') {
      return jsonResponse({
        ok: true,
        challengeId: 'rc_v12_9',
        message: 'msg_v12_9',
        campaignId: 'camp-ux-test-1',
        walletAddress: WALLET_A,
      }, 201);
    }
    if (url.includes('/submit') && method === 'POST') {
      return submitDeferred.promise;
    }
    return jsonResponse({}, 500);
  });

  const mounted = await mountCampaignCard({
    walletContext: makeMockWalletContext({
      connected: true,
      publicKey: makeMockPublicKey(WALLET_A),
      signMessage: async () => new Uint8Array(64).fill(1),
    }),
    onSubmissionSuccess: () => {
      onSuccessCalls += 1;
    },
  });

  try {
    fillValidFields(mounted.container, WALLET_A);
    dom.submitForm(getForm(mounted.container));
    await mounted.flush(20);

    await mounted.update({
      walletContext: makeMockWalletContext({
        connected: true,
        publicKey: makeMockPublicKey(WALLET_B),
        signMessage: async () => new Uint8Array(64).fill(2),
      }),
    });

    // Immediately resolve right after wallet transition
    submitDeferred.resolve(
      jsonResponse({
        ok: true,
        submission: {
          id: 'sub-v12-9',
          campaignId: 'camp-ux-test-1',
          walletAddress: WALLET_A,
          xHandle: '@raider_hero',
          xRetweetLink: 'https://x.com/raider_hero/status/1850000000000000999',
          status: 'PENDING',
          submittedAt: new Date().toISOString(),
        },
      }, 201)
    );
    await mounted.flush(25);

    assert.equal(onSuccessCalls, 0);
    assert.equal(fx.calls.filter((c) => c.url.includes('/submit')).length, 1);
    assert.ok(!mounted.container.textContent.includes('Raid Proof Submitted'));
    assert.ok(mounted.container.textContent.includes(EXPECTED_WALLET_CHANGED_WARNING));
  } finally {
    await mounted.unmount();
    fx.restore();
  }
});

test('V1.2 [10/10]: Backend rejection remains a rejection and never produces a success state', async () => {
  const jsonDeferred = makeDeferred();
  let onSuccessCalls = 0;

  const fx = withMockFetch(({ url, method }) => {
    if (url === '/api/auth/session' && method === 'GET') {
      return jsonResponse({ authenticated: true, wallet: WALLET_A }, 200);
    }
    if (url.includes('/challenge') && method === 'POST') {
      return jsonResponse({
        ok: true,
        challengeId: 'rc_v12_10',
        message: 'msg_v12_10',
        campaignId: 'camp-ux-test-1',
        walletAddress: WALLET_A,
      }, 201);
    }
    if (url.includes('/submit') && method === 'POST') {
      return {
        ok: false,
        status: 409,
        json: () => jsonDeferred.promise,
      };
    }
    return jsonResponse({}, 500);
  });

  const mounted = await mountCampaignCard({
    walletContext: makeMockWalletContext({
      connected: true,
      publicKey: makeMockPublicKey(WALLET_A),
      signMessage: async () => new Uint8Array(64).fill(1),
    }),
    onSubmissionSuccess: () => {
      onSuccessCalls += 1;
    },
  });

  try {
    fillValidFields(mounted.container, WALLET_A);
    dom.submitForm(getForm(mounted.container));
    await mounted.flush(20);

    // Wallet changes before JSON parsing completes, and backend rejected with 409
    await mounted.update({
      walletContext: makeMockWalletContext({
        connected: true,
        publicKey: makeMockPublicKey(WALLET_B),
        signMessage: async () => new Uint8Array(64).fill(2),
      }),
    });

    jsonDeferred.resolve({
      ok: false,
      error: 'Duplicate challenge submission rejected by server.',
    });
    await mounted.flush(25);

    assert.equal(onSuccessCalls, 0);
    assert.ok(!mounted.container.textContent.includes('Raid Proof Submitted'));
    assert.ok(!mounted.container.textContent.includes(EXPECTED_WALLET_CHANGED_WARNING));
    assert.ok(
      mounted.container.textContent.includes('Duplicate challenge submission rejected by server.')
    );
  } finally {
    await mounted.unmount();
    fx.restore();
  }
});
