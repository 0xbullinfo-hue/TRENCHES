'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Send } from 'lucide-react';
import { useGenesisBalance } from '@/context/GenesisContext';

const ENABLED = process.env.NEXT_PUBLIC_TELEGRAM_ALERTS === 'true';
const LINK_PATH = '/api/telegram/link';
const hintKey = (wallet: string) => `trenchlabs_tg_linked_v1:${wallet}`;

type Status = 'idle' | 'working' | 'waiting' | 'linked';

/** One button in the existing utility bar: link Telegram to get every new call pushed to you. */
export function TelegramAlerts() {
  const { publicKeyBase58, signRequestHeaders } = useGenesisBalance();
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollGenRef = useRef(0);

  const stopPolling = () => {
    pollGenRef.current += 1;
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  };

  useEffect(() => stopPolling, []);

  useEffect(() => {
    stopPolling();
    setMessage(null);
    try {
      setStatus(publicKeyBase58 && localStorage.getItem(hintKey(publicKeyBase58)) === 'true' ? 'linked' : 'idle');
    } catch {
      setStatus('idle');
    }
  }, [publicKeyBase58]);

  const call = useCallback(
    async (method: 'GET' | 'POST' | 'DELETE') => {
      const headers = await signRequestHeaders(method, LINK_PATH);
      if (!headers) throw new Error('Sign the message in your wallet to continue.');
      const res = await fetch(LINK_PATH, { method, headers, cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.message || 'Request failed.');
      return json as { linked?: boolean; url?: string };
    },
    [signRequestHeaders]
  );

  const start = async () => {
    if (!publicKeyBase58) return;
    setStatus('working');
    setMessage(null);
    try {
      const currentGen = ++pollGenRef.current;
      const targetWallet = publicKeyBase58;
      const { url } = await call('POST');
      if (pollGenRef.current !== currentGen || targetWallet !== publicKeyBase58) return;
      if (!url) throw new Error('No link returned.');
      window.open(url, '_blank', 'noopener,noreferrer');
      setStatus('waiting');
      let tries = 0;
      pollRef.current = setInterval(async () => {
        if (pollGenRef.current !== currentGen || targetWallet !== publicKeyBase58) {
          stopPolling();
          return;
        }
        tries += 1;
        try {
          const { linked } = await call('GET');
          if (pollGenRef.current !== currentGen || targetWallet !== publicKeyBase58) return;
          if (linked) {
            stopPolling();
            try {
              localStorage.setItem(hintKey(targetWallet), 'true');
            } catch {
              /* ignore */
            }
            setStatus('linked');
          }
        } catch {
          /* keep polling */
        }
        if (tries >= 40) {
          stopPolling();
          if (pollGenRef.current === currentGen && targetWallet === publicKeyBase58) {
            setStatus('idle');
            setMessage('Link not completed. Tap again and press Start in Telegram.');
          }
        }
      }, 3_000);
    } catch (e) {
      setStatus('idle');
      setMessage((e as Error).message);
    }
  };

  const stop = async () => {
    if (!publicKeyBase58) return;
    setStatus('working');
    try {
      await call('DELETE');
      try {
        localStorage.removeItem(hintKey(publicKeyBase58));
      } catch {
        /* ignore */
      }
      setStatus('idle');
    } catch (e) {
      setStatus('linked');
      setMessage((e as Error).message);
    }
  };

  if (!ENABLED) return null;

  return (
    <div className="w-full">
      {status === 'linked' ? (
        <div className="flex items-center justify-between w-full px-3 py-2 rounded bg-toxic-bg border border-toxic-border font-mono text-xs">
          <span className="inline-flex items-center gap-1.5 text-pump font-bold uppercase text-[10px]">
            <Check className="w-3.5 h-3.5" /> Telegram alerts on
          </span>
          <button
            type="button"
            onClick={stop}
            className="text-muted hover:text-danger text-[11px] underline cursor-pointer"
          >
            Turn off
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={start}
          disabled={!publicKeyBase58 || status === 'working' || status === 'waiting'}
          className="w-full h-9 rounded bg-surface-card hover:bg-pump hover:text-canvas border border-line font-sans text-xs font-bold text-pump flex items-center justify-center gap-2 cursor-pointer transition-colors disabled:opacity-60 disabled:cursor-default"
        >
          <Send className="w-3.5 h-3.5" />
          <span>
            {status === 'waiting'
              ? 'Press Start in Telegram…'
              : status === 'working'
                ? 'Working…'
                : 'Get new calls on Telegram'}
          </span>
        </button>
      )}
      {message && <p className="mt-1.5 font-sans text-[11px] text-danger">{message}</p>}
    </div>
  );
}
