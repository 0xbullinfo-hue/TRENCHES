import type { Page } from '@playwright/test';
import crypto from 'node:crypto';
import { Keypair } from '@solana/web3.js';

const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

export function signEd25519Bytes(kp: Keypair, messageBytes: Uint8Array): Uint8Array {
  const privKey = crypto.createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, Buffer.from(kp.secretKey.subarray(0, 32))]),
    format: 'der',
    type: 'pkcs8',
  });
  return new Uint8Array(crypto.sign(null, Buffer.from(messageBytes), privKey));
}

export async function injectPhantomWallet(page: Page, kp: Keypair): Promise<void> {
  const pubkeyBase58 = kp.publicKey.toBase58();
  const pubkeyBytes = Array.from(kp.publicKey.toBytes());

  await page.exposeFunction('__pwSignEd25519', (bytes: number[]) => {
    const sig = signEd25519Bytes(kp, new Uint8Array(bytes));
    return Array.from(sig);
  });

  await page.addInitScript(
    ({ base58, bytes }: { base58: string; bytes: number[] }) => {
      const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
      const emit = (event: string, ...args: unknown[]) => {
        const set = listeners.get(event);
        if (!set) return;
        for (const fn of set) fn(...args);
      };

      const makePubKey = () => ({
        toBase58: () => base58,
        toString: () => base58,
        toBytes: () => new Uint8Array(bytes),
        toBuffer: () => new Uint8Array(bytes),
        equals: (other: { toBase58?: () => string }) => other?.toBase58?.() === base58,
      });

      const provider = {
        isPhantom: true,
        isConnected: false,
        publicKey: null as ReturnType<typeof makePubKey> | null,
        connect: async () => {
          const pk = makePubKey();
          provider.publicKey = pk;
          provider.isConnected = true;
          emit('connect', pk);
          return { publicKey: pk };
        },
        disconnect: async () => {
          provider.publicKey = null;
          provider.isConnected = false;
          emit('disconnect');
        },
        signMessage: async (message: Uint8Array) => {
          const win = window as unknown as {
            __pwSignEd25519: (b: number[]) => Promise<number[]>;
          };
          const sigArr = await win.__pwSignEd25519(Array.from(message));
          return { signature: new Uint8Array(sigArr), publicKey: provider.publicKey };
        },
        on: (event: string, fn: (...args: unknown[]) => void) => {
          if (!listeners.has(event)) listeners.set(event, new Set());
          listeners.get(event)!.add(fn);
        },
        off: (event: string, fn: (...args: unknown[]) => void) => {
          listeners.get(event)?.delete(fn);
        },
        removeListener: (event: string, fn: (...args: unknown[]) => void) => {
          listeners.get(event)?.delete(fn);
        },
      };

      const win = window as unknown as Record<string, unknown>;
      win.phantom = { solana: provider };
      win.solana = provider;
    },
    { base58: pubkeyBase58, bytes: pubkeyBytes }
  );
}

export async function connectInjectedPhantom(page: Page): Promise<void> {
  await page.waitForLoadState('load');

  // Strategy 1: Try clicking through the TrenchWalletModal UI
  const connectBtn = page.getByRole('button', { name: 'Connect Solana Wallet' });
  try {
    await connectBtn.waitFor({ state: 'visible', timeout: 10000 });
  } catch {
    // "Connect Solana Wallet" button not found — wallet may already be connected
    // or the page uses a different layout. Skip to programmatic connect.
    await connectPhantomProgrammatically(page);
    return;
  }

  const phantomBtn = page.getByRole('button', { name: /Phantom/i }).first();
  for (let attempt = 0; attempt < 4; attempt++) {
    await connectBtn.click();
    try {
      await phantomBtn.waitFor({ state: 'visible', timeout: 2000 });
      await phantomBtn.click();
      // Wait briefly for wallet connection to propagate
      await page.waitForTimeout(1000);
      // Verify the wallet connected (the Connect button should disappear or change)
      const stillVisible = await connectBtn.isVisible().catch(() => false);
      if (!stillVisible) return; // Success — wallet connected
      // Button still visible means connection didn't complete, try programmatic
      break;
    } catch {
      // Modal didn't appear or click didn't work
      await page.waitForTimeout(500);
    }
  }

  // Strategy 2: Programmatic connect — call window.phantom.solana.connect() directly
  // then trigger wallet-adapter-react to pick it up
  await connectPhantomProgrammatically(page);
}

async function connectPhantomProgrammatically(page: Page): Promise<void> {
  // Connect the injected Phantom provider directly
  await page.evaluate(async () => {
    const win = window as unknown as Record<string, unknown>;
    const phantom = win.phantom as { solana?: { connect: () => Promise<unknown> } } | undefined;
    if (phantom?.solana) {
      await phantom.solana.connect();
    }
  });

  // Wait for the React context to pick up the connection
  await page.waitForTimeout(2000);

  // Try clicking the Connect Wallet button and selecting Phantom one more time
  // now that Phantom is already "connected" — the adapter should auto-detect it
  const connectBtn = page.getByRole('button', { name: 'Connect Solana Wallet' });
  const isConnectVisible = await connectBtn.isVisible().catch(() => false);
  if (isConnectVisible) {
    await connectBtn.click();
    const phantomBtn = page.getByRole('button', { name: /Phantom/i }).first();
    try {
      await phantomBtn.waitFor({ state: 'visible', timeout: 3000 });
      await phantomBtn.click();
      await page.waitForTimeout(1500);
    } catch {
      // If modal still doesn't work, the provider is at least connected via window.phantom
      // The CampaignCard may still show the wallet as connected via adapter detection
    }
  }
}
