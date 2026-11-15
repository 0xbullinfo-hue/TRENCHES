'use client';

import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useGenesisBalance } from '@/context/GenesisContext';
import { isBase58Address } from '@/lib/config';
import type { Campaign, CampaignSubmission } from '@/lib/types';

/**
 * Section 4.2 & 4.3:
 * Display CONFIGURED DURATION ONLY (e.g. 12 HOURS, 24 HOURS, 48 HOURS, 3 DAYS, 7 DAYS, 14 DAYS, N WEEKS).
 * Persisted durationHours is authoritative. Legacy records fall back safely or report "Duration unavailable".
 * Strictly NO countdown timers, no remaining hours/minutes, no tooltips revealing exact closing dates.
 */
export function getConfiguredDurationLabel(
  durationHours?: number,
  createdAt?: string,
  expiresAt?: string
): string {
  if (typeof durationHours === 'number' && Number.isFinite(durationHours) && durationHours > 0) {
    if (durationHours % 168 === 0) {
      const weeks = durationHours / 168;
      return `${weeks} ${weeks === 1 ? 'WEEK' : 'WEEKS'}`;
    }
    if (durationHours % 24 === 0 && durationHours >= 48) {
      return `${durationHours / 24} DAYS`;
    }
    if (durationHours === 24) return '24 HOURS';
    return `${durationHours} HOURS`;
  }

  // Safe fallback for legacy records
  if (expiresAt && createdAt) {
    try {
      const end = new Date(expiresAt).getTime();
      const start = new Date(createdAt).getTime();
      const diffHours = Math.round((end - start) / (1000 * 60 * 60));
      if (diffHours > 0) {
        if (diffHours % 168 === 0) {
          const weeks = diffHours / 168;
          return `${weeks} ${weeks === 1 ? 'WEEK' : 'WEEKS'}`;
        }
        if (diffHours % 24 === 0 && diffHours >= 48) {
          return `${diffHours / 24} DAYS`;
        }
        if (diffHours <= 14) return '12 HOURS';
        if (diffHours <= 28) return '24 HOURS';
        if (diffHours <= 54) return '48 HOURS';
        if (diffHours <= 84) return '3 DAYS';
        if (diffHours <= 180) return '7 DAYS';
        if (diffHours <= 360) return '14 DAYS';
      }
    } catch {
      // ignore
    }
  }

  return 'Duration unavailable';
}

export type ServerSessionStatus =
  | 'UNKNOWN'
  | 'CHECKING'
  | 'AUTHENTICATED'
  | 'UNAUTHENTICATED'
  | 'ERROR';

export interface ServerSessionState {
  status: ServerSessionStatus;
  wallet: string | null;
  error?: string | null;
}

/**
 * Fix A: Authoritative wallet connection state derived strictly from the active
 * Solana wallet adapter. Never falls back to stale GenesisContext or input addresses.
 */
export function getAuthoritativeWalletState(wallet: ReturnType<typeof useWallet>) {
  const adapter = wallet.wallet?.adapter ?? null;
  const walletPk = wallet.publicKey ? wallet.publicKey.toBase58() : null;
  const adapterPk = adapter?.publicKey ? adapter.publicKey.toBase58() : null;

  const isConnected = Boolean(
    wallet.connected &&
      adapter &&
      adapter.connected &&
      walletPk &&
      isBase58Address(walletPk) &&
      adapterPk &&
      adapterPk === walletPk
  );

  return {
    isConnected,
    address: isConnected ? walletPk : null,
    adapter: isConnected ? adapter : null,
  };
}

export function isValidSubmissionPayload(
  sub: unknown,
  expectedCampaignId: string,
  expectedWallet: string
): sub is CampaignSubmission {
  if (!sub || typeof sub !== 'object') return false;
  const s = sub as Record<string, unknown>;
  return (
    typeof s.id === 'string' &&
    s.id.trim().length > 0 &&
    s.campaignId === expectedCampaignId &&
    s.walletAddress === expectedWallet
  );
}

export interface UseCampaignSubmissionParams {
  campaign: Campaign;
  userWallet?: string | null;
  isAdmin?: boolean;
  onSubmissionSuccess?: (submission: CampaignSubmission) => void;
  onTogglePin?: (campaignId: string, pinned: boolean) => void;
}

export function useCampaignSubmission({
  campaign,
  userWallet,
  isAdmin: _isAdmin,
  onSubmissionSuccess,
}: UseCampaignSubmissionParams) {
  const wallet = useWallet();
  const {
    connectWallet: openConnectWalletModal,
    switchWallet: handleSwitchWallet,
  } = useGenesisBalance();

  const authWallet = getAuthoritativeWalletState(wallet);
  const connectedAddress = authWallet.address;
  const activeAdapter = authWallet.adapter;

  const [walletInput, setWalletInput] = useState(connectedAddress || '');
  const [xHandleInput, setXHandleInput] = useState('');
  const [retweetLinkInput, setRetweetLinkInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [authenticatingSession, setAuthenticatingSession] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [userSubmission, setUserSubmission] = useState<CampaignSubmission | null>(
    campaign.userSubmission || null
  );
  const [copiedWallet, setCopiedWallet] = useState(false);
  const [serverSession, setServerSession] = useState<ServerSessionState>({
    status: authWallet.isConnected ? 'CHECKING' : 'UNKNOWN',
    wallet: null,
    error: null,
  });
  const [now, setNow] = useState<number>(() =>
    typeof window !== 'undefined' ? Date.now() : 0
  );

  const submittingRef = useRef(false);
  const sessionCheckGenRef = useRef(0);
  const submitAttemptGenRef = useRef(0);
  const activeSubmitGenRef = useRef(0);
  const sessionAbortControllerRef = useRef<AbortController | null>(null);
  const submitAbortControllerRef = useRef<AbortController | null>(null);
  const latestWalletRef = useRef<{
    isConnected: boolean;
    address: string | null;
    adapter: typeof activeAdapter;
  }>({
    isConnected: authWallet.isConnected,
    address: connectedAddress,
    adapter: activeAdapter,
  });

  // Synchronize committed wallet snapshot at commit phase before async callbacks run
  useLayoutEffect(() => {
    const prev = latestWalletRef.current;
    const identityChanged =
      prev.isConnected !== authWallet.isConnected ||
      prev.address !== connectedAddress ||
      prev.adapter !== activeAdapter;

    latestWalletRef.current = {
      isConnected: authWallet.isConnected,
      address: connectedAddress,
      adapter: activeAdapter,
    };

    if (identityChanged) {
      submitAttemptGenRef.current += 1;
      submittingRef.current = false;
      setSubmitting(false);
    }
  }, [authWallet.isConnected, connectedAddress, activeAdapter]);

  // Suppress unused prop warning while preserving prop API compatibility
  void userWallet;

  // Expiration boundary trigger and visibilitychange refresh (no polling, no decorative countdown)
  useEffect(() => {
    if (!campaign.expiresAt || campaign.status === 'COMPLETED' || campaign.status === 'PAUSED') {
      return;
    }
    const expiresAtMs = new Date(campaign.expiresAt).getTime();
    if (!Number.isFinite(expiresAtMs)) return;

    let timer: NodeJS.Timeout | null = null;
    const remainingMs = expiresAtMs - Date.now();
    if (remainingMs > 0) {
      // Clamp delay to max 32-bit signed int (~24.8 days)
      const delay = Math.min(remainingMs, 2_147_483_647);
      timer = setTimeout(() => {
        setNow(Date.now());
      }, delay);
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        setNow(Date.now());
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [campaign.expiresAt, campaign.status]);

  useEffect(() => {
    return () => {
      sessionAbortControllerRef.current?.abort();
      submitAbortControllerRef.current?.abort();
    };
  }, []);

  // Keep wallet input prefilled when an authoritative wallet connects
  useEffect(() => {
    let active = true;
    if (authWallet.isConnected && connectedAddress) {
      queueMicrotask(() => {
        if (active) {
          setWalletInput((prev) => (!prev ? connectedAddress : prev));
        }
      });
    }
    return () => {
      active = false;
    };
  }, [authWallet.isConnected, connectedAddress]);

  // Fix B: Verify actual server-authenticated session on wallet connection or account/adapter change
  useEffect(() => {
    const gen = ++sessionCheckGenRef.current;

    const capturedAddress = connectedAddress;
    const capturedAdapter = activeAdapter;
    const capturedConnected = authWallet.isConnected;

    queueMicrotask(() => {
      if (sessionCheckGenRef.current !== gen) return;

      if (!capturedConnected || !capturedAddress || !capturedAdapter) {
        setServerSession({ status: 'UNKNOWN', wallet: null, error: null });
        return;
      }

      setServerSession({ status: 'CHECKING', wallet: null, error: null });

      sessionAbortControllerRef.current?.abort();
      const controller = new AbortController();
      sessionAbortControllerRef.current = controller;

      (async () => {
        try {
          const res = await fetch('/api/auth/session', { credentials: 'include', signal: controller.signal });

          // Ignore stale responses or wallet changes that occurred during the fetch
          const latest = latestWalletRef.current;
          if (
            sessionCheckGenRef.current !== gen ||
            !latest.isConnected ||
            latest.address !== capturedAddress ||
            latest.adapter !== capturedAdapter ||
            !latest.adapter?.connected
          ) {
            return;
          }

          if (res.status === 401) {
            setServerSession({ status: 'UNAUTHENTICATED', wallet: null, error: null });
            return;
          }

          if (!res.ok) {
            setServerSession({
              status: 'ERROR',
              wallet: null,
              error: 'Unable to verify server session.',
            });
            return;
          }

          const data = await res.json().catch(() => null);

          // Recheck active wallet before accepting result
          const latestAfterJson = latestWalletRef.current;
          if (
            sessionCheckGenRef.current !== gen ||
            !latestAfterJson.isConnected ||
            latestAfterJson.address !== capturedAddress ||
            latestAfterJson.adapter !== capturedAdapter ||
            !latestAfterJson.adapter?.connected
          ) {
            return;
          }

          if (
            data &&
            data.authenticated === true &&
            typeof data.wallet === 'string' &&
            data.wallet === capturedAddress
          ) {
            setServerSession({ status: 'AUTHENTICATED', wallet: capturedAddress, error: null });
          } else {
            setServerSession({ status: 'UNAUTHENTICATED', wallet: null, error: null });
          }
        } catch {
          const latestOnErr = latestWalletRef.current;
          if (
            sessionCheckGenRef.current !== gen ||
            !latestOnErr.isConnected ||
            latestOnErr.address !== capturedAddress ||
            latestOnErr.adapter !== capturedAdapter
          ) {
            return;
          }
          setServerSession({
            status: 'ERROR',
            wallet: null,
            error: 'Network error while verifying server session.',
          });
        }
      })();
    });
  }, [authWallet.isConnected, connectedAddress, activeAdapter]);

  // Keep submission state synced if props refresh
  useEffect(() => {
    let active = true;
    if (campaign.userSubmission) {
      queueMicrotask(() => {
        if (active) {
          setUserSubmission(campaign.userSubmission || null);
        }
      });
    }
    return () => {
      active = false;
    };
  }, [campaign.userSubmission]);

  const activeSignMessage =
    wallet.signMessage ||
    (activeAdapter && typeof (activeAdapter as unknown as { signMessage?: unknown }).signMessage === 'function'
      ? (activeAdapter as unknown as { signMessage: (msg: Uint8Array) => Promise<Uint8Array> }).signMessage.bind(activeAdapter)
      : null);

  const cleanWallet = walletInput.trim();
  const cleanHandle = xHandleInput.trim();
  const cleanRetweet = retweetLinkInput.trim();

  // Authoritative connection & verification flags
  const isWalletConnected = authWallet.isConnected && Boolean(connectedAddress);
  const isWalletMismatched = Boolean(
    isWalletConnected && cleanWallet && connectedAddress && cleanWallet !== connectedAddress
  );
  const isSigningSupported = Boolean(isWalletConnected && activeSignMessage);
  const isServerSessionAuthenticated = Boolean(
    isWalletConnected &&
      !isWalletMismatched &&
      serverSession.status === 'AUTHENTICATED' &&
      serverSession.wallet === connectedAddress
  );

  // Reusable wallet identity verification helper for async checkpoints
  const isWalletIdentityValid = useCallback(
    (
      capturedAddress: string,
      capturedAdapter: typeof activeAdapter,
      attemptGen?: number
    ): boolean => {
      if (typeof attemptGen === 'number' && submitAttemptGenRef.current !== attemptGen) {
        return false;
      }
      if (!capturedAdapter || !isBase58Address(capturedAddress)) {
        return false;
      }
      const latest = latestWalletRef.current;
      const adapterPk = capturedAdapter.publicKey ? capturedAdapter.publicKey.toBase58() : null;
      return Boolean(
        latest.isConnected &&
          latest.adapter &&
          latest.adapter === capturedAdapter &&
          latest.adapter.connected &&
          latest.address &&
          latest.address === capturedAddress &&
          capturedAdapter.connected &&
          adapterPk === capturedAddress
      );
    },
    []
  );

  const abortForWalletChange = useCallback((customMsg?: string) => {
    setServerSession({ status: 'UNAUTHENTICATED', wallet: null, error: null });
    setSuccessMsg(null);
    setErrorMsg(
      customMsg ||
        'Wallet disconnected or switched during submission. Please reconnect and authenticate again.'
    );
  }, []);

  const verifyServerSessionForWallet = useCallback(
    async (
      capturedAddress: string,
      capturedAdapter: typeof activeAdapter,
      attemptGen?: number
    ): Promise<{ ok: boolean; authenticated: boolean; aborted: boolean; error?: string }> => {
      if (!isWalletIdentityValid(capturedAddress, capturedAdapter, attemptGen)) {
        return { ok: false, authenticated: false, aborted: true };
      }

      try {
        const sessionRes = await fetch('/api/auth/session', { credentials: 'include' });

        if (!isWalletIdentityValid(capturedAddress, capturedAdapter, attemptGen)) {
          return { ok: false, authenticated: false, aborted: true };
        }

        if (sessionRes.status === 401) {
          return { ok: true, authenticated: false, aborted: false };
        }

        if (!sessionRes.ok) {
          return {
            ok: false,
            authenticated: false,
            aborted: false,
            error: 'Unable to verify server session.',
          };
        }

        const sess = await sessionRes.json().catch(() => null);

        if (!isWalletIdentityValid(capturedAddress, capturedAdapter, attemptGen)) {
          return { ok: false, authenticated: false, aborted: true };
        }

        const isMatch = Boolean(
          sess &&
            sess.authenticated === true &&
            typeof sess.wallet === 'string' &&
            sess.wallet === capturedAddress
        );
        return { ok: true, authenticated: isMatch, aborted: false };
      } catch {
        if (!isWalletIdentityValid(capturedAddress, capturedAdapter, attemptGen)) {
          return { ok: false, authenticated: false, aborted: true };
        }
        return {
          ok: false,
          authenticated: false,
          aborted: false,
          error: 'Network error while verifying server session.',
        };
      }
    },
    [isWalletIdentityValid]
  );

  const handleAuthenticateSession = async () => {
    if (authenticatingSession || submittingRef.current) return;
    const current = getAuthoritativeWalletState(wallet);
    if (!current.isConnected || !current.address || !current.adapter) {
      setErrorMsg('Please connect your Solana wallet first.');
      return;
    }
    if (!activeSignMessage) {
      setErrorMsg(
        'Connected wallet does not support message signing. Please connect with Phantom, Solflare, or Trust Wallet.'
      );
      return;
    }

    const capturedAddress = current.address;
    const capturedAdapter = current.adapter;
    setErrorMsg(null);
    setSuccessMsg(null);
    setAuthenticatingSession(true);
    setServerSession({ status: 'CHECKING', wallet: null, error: null });

    try {
      const ts = Date.now();
      const sessionMsg = `TrenchLabs Access|POST|/api/auth/session|${ts}`;
      let sessSigBytes: Uint8Array;
      try {
        sessSigBytes = await activeSignMessage(new TextEncoder().encode(sessionMsg));
      } catch (signErr) {
        const errMsg = (signErr as Error)?.message || '';
        if (/user rejected|window closed|cancelled|canceled|denied/i.test(errMsg)) {
          setServerSession({ status: 'UNAUTHENTICATED', wallet: null, error: null });
          setErrorMsg('Session signature rejected. Wallet authentication is required.');
          return;
        }
        throw new Error('Failed to sign authentication session message.');
      }

      if (!isWalletIdentityValid(capturedAddress, capturedAdapter)) {
        abortForWalletChange();
        return;
      }

      const sessSigHex = Array.from(sessSigBytes)
        .map((b) => (b as number).toString(16).padStart(2, '0'))
        .join('');

      const authRes = await fetch('/api/auth/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          wallet: capturedAddress,
          signature: sessSigHex,
          timestamp: ts,
        }),
      });

      if (!isWalletIdentityValid(capturedAddress, capturedAdapter)) {
        abortForWalletChange();
        return;
      }

      if (!authRes.ok) {
        const authData = await authRes.json().catch(() => null);
        setServerSession({ status: 'UNAUTHENTICATED', wallet: null, error: null });
        setErrorMsg(authData?.error || 'Wallet session authentication failed. Please retry.');
        return;
      }

      // Confirm server session via GET /api/auth/session before marking AUTHENTICATED
      const confirm = await verifyServerSessionForWallet(capturedAddress, capturedAdapter);
      if (confirm.aborted) {
        abortForWalletChange();
        return;
      }
      if (!confirm.ok || !confirm.authenticated) {
        setServerSession({
          status: confirm.ok ? 'UNAUTHENTICATED' : 'ERROR',
          wallet: null,
          error: confirm.error || 'Server session confirmation failed.',
        });
        setErrorMsg(confirm.error || 'Server session could not be confirmed. Please retry.');
        return;
      }

      setServerSession({ status: 'AUTHENTICATED', wallet: capturedAddress, error: null });
    } catch (err) {
      setServerSession({
        status: 'ERROR',
        wallet: null,
        error: (err as Error).message,
      });
      setErrorMsg((err as Error).message || 'Session authentication failed.');
    } finally {
      setAuthenticatingSession(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submittingRef.current) return;
    if (isCompleted || isPaused || isExpired) {
      setErrorMsg(`Submissions are closed for this campaign (${statusLabel}).`);
      return;
    }
    setErrorMsg(null);
    setSuccessMsg(null);

    // 1. Authoritative connection check
    const initialWallet = getAuthoritativeWalletState(wallet);
    if (!initialWallet.isConnected || !initialWallet.address || !initialWallet.adapter) {
      setErrorMsg('Please connect your Solana wallet before submitting raid proof.');
      return;
    }

    const capturedAddress = initialWallet.address;
    const capturedAdapter = initialWallet.adapter;

    // 2. Address matching check
    if (!cleanWallet) {
      setErrorMsg('Please enter your Solana wallet address for the airdrop.');
      return;
    }
    if (!isBase58Address(cleanWallet)) {
      setErrorMsg('Invalid Solana wallet address format.');
      return;
    }
    if (cleanWallet !== capturedAddress) {
      setErrorMsg(
        `Entered address does not match your connected wallet (${capturedAddress.slice(0, 4)}...${capturedAddress.slice(-4)}). Use connected address or switch wallets.`
      );
      return;
    }

    // 3. Field validation
    if (!cleanHandle) {
      setErrorMsg('Please enter your @X (Twitter) handle.');
      return;
    }
    if (!cleanRetweet) {
      setErrorMsg('Please paste the URL link to your retweet/quote.');
      return;
    }
    if (!/https?:\/\/(www\.)?(twitter\.com|x\.com)\/[a-zA-Z0-9_]{1,15}\/status\/[0-9]+/i.test(cleanRetweet)) {
      setErrorMsg('Invalid X / Twitter retweet URL. Must be a valid link on x.com or twitter.com.');
      return;
    }

    // 4. Signing support check
    if (!activeSignMessage) {
      setErrorMsg(
        'Connected wallet does not support message signing. Please connect with Phantom, Solflare, or Trust Wallet.'
      );
      return;
    }

    // Acquire synchronous in-flight guard & capture attempt generation
    submitAbortControllerRef.current?.abort();
    const submitController = new AbortController();
    submitAbortControllerRef.current = submitController;

    const attemptGen = ++submitAttemptGenRef.current;
    activeSubmitGenRef.current = attemptGen;
    const isSuperseded = () => activeSubmitGenRef.current !== attemptGen;
    submittingRef.current = true;
    setSubmitting(true);

    try {
      // Checkpoint 1: Before session lookup
      if (!isWalletIdentityValid(capturedAddress, capturedAdapter, attemptGen)) {
        if (!isSuperseded()) abortForWalletChange();
        return;
      }

      // Step A: Verify active server authentication session via GET /api/auth/session
      const initialSessionCheck = await verifyServerSessionForWallet(
        capturedAddress,
        capturedAdapter,
        attemptGen
      );

      // Checkpoint 2: Immediately after session lookup
      if (
        initialSessionCheck.aborted ||
        !isWalletIdentityValid(capturedAddress, capturedAdapter, attemptGen)
      ) {
        abortForWalletChange();
        return;
      }

      if (!initialSessionCheck.authenticated) {
        setServerSession({ status: 'UNAUTHENTICATED', wallet: null, error: null });

        // Checkpoint 3: Before session signing
        if (!isWalletIdentityValid(capturedAddress, capturedAdapter, attemptGen)) {
          abortForWalletChange();
          return;
        }

        const ts = Date.now();
        const sessionMsg = `TrenchLabs Access|POST|/api/auth/session|${ts}`;
        let sessSigBytes: Uint8Array;
        try {
          sessSigBytes = await activeSignMessage(new TextEncoder().encode(sessionMsg));
        } catch (sessSignErr) {
          const errMsg = (sessSignErr as Error)?.message || '';
          if (/user rejected|window closed|cancelled|canceled|denied/i.test(errMsg)) {
            setServerSession({ status: 'UNAUTHENTICATED', wallet: null, error: null });
            setErrorMsg('Session signature rejected. Wallet authentication is required to participate.');
            return;
          }
          throw new Error('Failed to sign authentication session message.');
        }

        // Checkpoint 4: Immediately after session signing
        if (!isWalletIdentityValid(capturedAddress, capturedAdapter, attemptGen)) {
          abortForWalletChange();
          return;
        }

        const sessSigHex = Array.from(sessSigBytes)
          .map((b) => (b as number).toString(16).padStart(2, '0'))
          .join('');

        // Step A.1: Authenticate session via POST /api/auth/session
        const authRes = await fetch('/api/auth/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            wallet: capturedAddress,
            signature: sessSigHex,
            timestamp: ts,
          }),
        });

        // Checkpoint 5: Immediately after session POST response
        if (!isWalletIdentityValid(capturedAddress, capturedAdapter, attemptGen)) {
          abortForWalletChange();
          return;
        }

        if (!authRes.ok) {
          const authData = await authRes.json().catch(() => null);
          setServerSession({ status: 'UNAUTHENTICATED', wallet: null, error: null });
          throw new Error(authData?.error || 'Failed to authenticate wallet session. Please retry.');
        }

        // Checkpoint 6: Immediately before session confirmation GET
        if (!isWalletIdentityValid(capturedAddress, capturedAdapter, attemptGen)) {
          abortForWalletChange();
          return;
        }

        // Step A.2: Confirm session cookie is recognized by server
        const confirmCheck = await verifyServerSessionForWallet(
          capturedAddress,
          capturedAdapter,
          attemptGen
        );

        if (
          confirmCheck.aborted ||
          !isWalletIdentityValid(capturedAddress, capturedAdapter, attemptGen)
        ) {
          abortForWalletChange();
          return;
        }

        if (!confirmCheck.ok || !confirmCheck.authenticated) {
          setServerSession({
            status: confirmCheck.ok ? 'UNAUTHENTICATED' : 'ERROR',
            wallet: null,
            error: confirmCheck.error || 'Server session confirmation failed.',
          });
          throw new Error(confirmCheck.error || 'Could not confirm server session. Please retry.');
        }
      }

      setServerSession({ status: 'AUTHENTICATED', wallet: capturedAddress, error: null });

      // Checkpoint 7: Immediately before challenge issuance
      if (!isWalletIdentityValid(capturedAddress, capturedAdapter, attemptGen)) {
        abortForWalletChange();
        return;
      }

      // Step B: Request fresh server-issued challenge
      const challengeRes = await fetch(`/api/campaigns/${campaign.id}/challenge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        signal: submitController.signal,
        body: JSON.stringify({ walletAddress: capturedAddress }),
      });

      // Checkpoint 8: Immediately after challenge response
      if (!isWalletIdentityValid(capturedAddress, capturedAdapter, attemptGen)) {
        abortForWalletChange();
        return;
      }

      const challengeData = await challengeRes.json().catch(() => null);
      if (!challengeRes.ok) {
        if (challengeRes.status === 401 || challengeRes.status === 403) {
          setServerSession({ status: 'UNAUTHENTICATED', wallet: null, error: null });
        }
        throw new Error(challengeData?.error || 'Failed to request raid verification challenge.');
      }

      // Fix C: Mandatory Challenge Binding Validation (all fields non-empty and exact match)
      const hasValidBinding = Boolean(
        challengeData &&
          challengeData.ok === true &&
          typeof challengeData.challengeId === 'string' &&
          challengeData.challengeId.trim().length > 0 &&
          typeof challengeData.message === 'string' &&
          challengeData.message.trim().length > 0 &&
          typeof challengeData.campaignId === 'string' &&
          challengeData.campaignId.trim().length > 0 &&
          typeof challengeData.walletAddress === 'string' &&
          challengeData.walletAddress.trim().length > 0 &&
          challengeData.campaignId === campaign.id &&
          challengeData.walletAddress === capturedAddress
      );

      if (!hasValidBinding) {
        throw new Error(
          'Challenge validation failed: server returned incomplete or mismatched campaign/wallet binding.'
        );
      }

      const activeChallengeId = challengeData.challengeId;

      // Checkpoint 9: Immediately before challenge signing
      if (!isWalletIdentityValid(capturedAddress, capturedAdapter, attemptGen)) {
        abortForWalletChange();
        return;
      }

      // Step C: Sign exact server challenge message
      let signatureHex: string;
      try {
        const sigBytes = await activeSignMessage(new TextEncoder().encode(challengeData.message));
        signatureHex = Array.from(sigBytes)
          .map((b) => (b as number).toString(16).padStart(2, '0'))
          .join('');
      } catch (signErr) {
        const signErrMsg = (signErr as Error)?.message || '';
        if (/user rejected|window closed|cancelled|canceled|denied/i.test(signErrMsg)) {
          setErrorMsg('Challenge signature rejected. Cryptographic proof is required to submit.');
          return;
        }
        throw new Error(signErrMsg || 'Failed to sign raid verification challenge.');
      }

      // Checkpoint 10: Immediately after challenge signing
      if (!isWalletIdentityValid(capturedAddress, capturedAdapter, attemptGen)) {
        abortForWalletChange();
        return;
      }

      // Checkpoint 11: Immediately before submission POST
      if (!isWalletIdentityValid(capturedAddress, capturedAdapter, attemptGen)) {
        abortForWalletChange();
        return;
      }

      // Step D: Submit raid proof to server
      const res = await fetch(`/api/campaigns/${campaign.id}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        signal: submitController.signal,
        body: JSON.stringify({
          challengeId: activeChallengeId,
          walletAddress: capturedAddress,
          xHandle: cleanHandle,
          xRetweetLink: cleanRetweet,
          signature: signatureHex,
        }),
      });

      // Checkpoint 12: Immediately after the HTTP response
      const identityValidAfterPost = isWalletIdentityValid(
        capturedAddress,
        capturedAdapter,
        attemptGen
      );

      const json = await res.json().catch(() => null);

      // Checkpoint 13: Immediately after response parsing
      const identityValidAfterJson = isWalletIdentityValid(
        capturedAddress,
        capturedAdapter,
        attemptGen
      );

      // If a newer submission attempt has started, never overwrite its UI state
      if (isSuperseded()) {
        return;
      }

      const serverAccepted = Boolean(
        res.ok &&
          json &&
          json.ok === true &&
          isValidSubmissionPayload(json.submission, campaign.id, capturedAddress)
      );

      if (!identityValidAfterPost || !identityValidAfterJson) {
        setSuccessMsg(null);
        if (serverAccepted) {
          setErrorMsg(
            'Your submission was accepted for the original wallet, but your connected wallet changed before confirmation. Reconnect the original wallet to view its submission status.'
          );
        }
        return;
      }

      if (!serverAccepted) {
        if (res.status === 401) {
          setServerSession({ status: 'UNAUTHENTICATED', wallet: null, error: null });
        }
        throw new Error(json?.error || 'Failed to submit raid proof');
      }

      setUserSubmission(json.submission);
      setSuccessMsg('Raid proof submitted! Awaiting admin airdrop verification.');
      if (onSubmissionSuccess) {
        onSubmissionSuccess(json.submission);
      }
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') {
        return;
      }
      if (
        !isSuperseded() &&
        isWalletIdentityValid(capturedAddress, capturedAdapter, attemptGen)
      ) {
        setErrorMsg((err as Error).message);
      }
    } finally {
      if (submitAttemptGenRef.current === attemptGen && !isSuperseded()) {
        submittingRef.current = false;
        setSubmitting(false);
      }
    }
  };

  const handleCopyWallet = (address: string) => {
    navigator.clipboard.writeText(address);
    setCopiedWallet(true);
    setTimeout(() => setCopiedWallet(false), 1800);
  };

  // Section 4.4: Authoritative Campaign Status (PAUSED and EXPIRED must be distinct)
  const isCompleted = campaign.status === 'COMPLETED';
  const isPaused = campaign.status === 'PAUSED';
  const isExpired =
    !isCompleted &&
    !isPaused &&
    !!campaign.expiresAt &&
    Boolean(now && new Date(campaign.expiresAt).getTime() <= now);
  const statusLabel = isCompleted
    ? 'COMPLETED'
    : isPaused
    ? 'PAUSED'
    : isExpired
    ? 'EXPIRED'
    : 'ACTIVE';
  const configuredDuration = getConfiguredDurationLabel(
    campaign.durationHours,
    campaign.createdAt,
    campaign.expiresAt
  );

  return {
    userSubmission,
    walletInput,
    setWalletInput,
    xHandleInput,
    setXHandleInput,
    retweetLinkInput,
    setRetweetLinkInput,
    submitting,
    authenticatingSession,
    errorMsg,
    successMsg,
    copiedWallet,
    serverSession,
    now,
    isWalletConnected,
    isSigningSupported,
    isWalletMismatched,
    isServerSessionAuthenticated,
    cleanWallet,
    cleanHandle,
    cleanRetweet,
    isCompleted,
    isPaused,
    isExpired,
    statusLabel,
    configuredDuration,
    connectedAddress,
    handleAuthenticateSession,
    handleSubmit,
    handleCopyWallet,
    handleSwitchWallet,
    openConnectWalletModal,
  };
}
