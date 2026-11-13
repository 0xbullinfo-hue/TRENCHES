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
  const connectBtn = page.getByRole('button', { name: 'Connect Solana Wallet' });
  await connectBtn.waitFor({ state: 'visible', timeout: 15000 });

  const phantomBtn = page.getByRole('button', { name: /Phantom/i }).first();
  for (let attempt = 0; attempt < 6; attempt++) {
    await connectBtn.click();
    try {
      await phantomBtn.waitFor({ state: 'visible', timeout: 1500 });
      break;
    } catch {
      await page.waitForTimeout(500);
    }
  }

  await phantomBtn.click();
}

