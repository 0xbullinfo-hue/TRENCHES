'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useGenesisBalance } from '@/context/GenesisContext';
import { isBase58Address } from '@/lib/config';
import type { Campaign, CampaignSubmission } from '@/lib/types';
import {
  ExternalLink,
  CheckCircle2,
  Clock,
  Sparkles,
  Send,
  AlertCircle,
  Copy,
  Check,
  Twitter,
  Pin,
  Wallet,
  ShieldCheck,
  RefreshCw,
} from 'lucide-react';

interface CampaignCardProps {
  campaign: Campaign;
  userWallet?: string | null;
  isAdmin?: boolean;
  onSubmissionSuccess?: (submission: CampaignSubmission) => void;
  onTogglePin?: (campaignId: string, pinned: boolean) => void;
}

/**
 * Section 4.2 & 4.3:
 * Display CONFIGURED DURATION ONLY (e.g. 12 HOURS, 24 HOURS, 48 HOURS, 3 DAYS, 7 DAYS, 14 DAYS, N WEEKS).
 * Persisted durationHours is authoritative. Legacy records fall back safely or report "Duration unavailable".
 * Strictly NO countdown timers, no remaining hours/minutes, no tooltips revealing exact closing dates.
 */
function getConfiguredDurationLabel(
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

interface ServerSessionState {
  status: ServerSessionStatus;
  wallet: string | null;
  error?: string | null;
}

/**
 * Fix A: Authoritative wallet connection state derived strictly from the active
 * Solana wallet adapter. Never falls back to stale GenesisContext or input addresses.
 */
function getAuthoritativeWalletState(wallet: ReturnType<typeof useWallet>) {
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

export const CampaignCard: React.FC<CampaignCardProps> = ({
  campaign,
  userWallet,
  isAdmin,
  onSubmissionSuccess,
  onTogglePin,
}) => {
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
  const latestWalletRef = useRef<{
    isConnected: boolean;
    address: string | null;
    adapter: typeof activeAdapter;
  }>({
    isConnected: authWallet.isConnected,
    address: connectedAddress,
    adapter: activeAdapter,
  });

  // Keep latestWalletRef synchronized after commits for async wallet identity checks
  useEffect(() => {
    latestWalletRef.current = {
      isConnected: authWallet.isConnected,
      address: connectedAddress,
      adapter: activeAdapter,
    };
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
    } else {
      queueMicrotask(() => {
        setNow(Date.now());
      });
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
    // Invalidate any in-flight submission attempt when wallet identity or adapter changes
    submitAttemptGenRef.current += 1;
    submittingRef.current = false;

    const capturedAddress = connectedAddress;
    const capturedAdapter = activeAdapter;
    const capturedConnected = authWallet.isConnected;

    queueMicrotask(() => {
      if (sessionCheckGenRef.current !== gen) return;
      setSubmitting(false);

      if (!capturedConnected || !capturedAddress || !capturedAdapter) {
        setServerSession({ status: 'UNKNOWN', wallet: null, error: null });
        return;
      }

      setServerSession({ status: 'CHECKING', wallet: null, error: null });

      (async () => {
        try {
          const res = await fetch('/api/auth/session', { credentials: 'include' });

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
      const latest = latestWalletRef.current;
      const adapterPk = capturedAdapter?.publicKey ? capturedAdapter.publicKey.toBase58() : null;
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
    const attemptGen = ++submitAttemptGenRef.current;
    submittingRef.current = true;
    setSubmitting(true);

    try {
      // Checkpoint 1: Before session lookup
      if (!isWalletIdentityValid(capturedAddress, capturedAdapter, attemptGen)) {
        abortForWalletChange();
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

        // Checkpoint 5: Immediately after session authentication
        if (!isWalletIdentityValid(capturedAddress, capturedAdapter, attemptGen)) {
          abortForWalletChange();
          return;
        }

        if (!authRes.ok) {
          const authData = await authRes.json().catch(() => null);
          setServerSession({ status: 'UNAUTHENTICATED', wallet: null, error: null });
          throw new Error(authData?.error || 'Wallet session authentication failed. Please retry.');
        }

        // Verify server session again before proceeding to challenge issuance
        const confirmSessionCheck = await verifyServerSessionForWallet(
          capturedAddress,
          capturedAdapter,
          attemptGen
        );

        // Checkpoint 6: After server-session confirmation
        if (
          confirmSessionCheck.aborted ||
          !isWalletIdentityValid(capturedAddress, capturedAdapter, attemptGen)
        ) {
          abortForWalletChange();
          return;
        }

        if (!confirmSessionCheck.ok || !confirmSessionCheck.authenticated) {
          setServerSession({
            status: confirmSessionCheck.ok ? 'UNAUTHENTICATED' : 'ERROR',
            wallet: null,
            error: confirmSessionCheck.error || 'Server session confirmation failed.',
          });
          throw new Error(
            confirmSessionCheck.error || 'Server session could not be confirmed. Please retry.'
          );
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
        body: JSON.stringify({
          challengeId: activeChallengeId,
          walletAddress: capturedAddress,
          xHandle: cleanHandle,
          xRetweetLink: cleanRetweet,
          signature: signatureHex,
        }),
      });

      const json = await res.json().catch(() => null);
      if (!res.ok || !json || json.ok !== true || !json.submission) {
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
      setErrorMsg((err as Error).message);
    } finally {
      if (submitAttemptGenRef.current === attemptGen) {
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

  return (
    <article
      tabIndex={0}
      aria-label={`X Raid Campaign: ${campaign.title}`}
      className="group relative rounded-xl bg-surface flex flex-col justify-between h-full transition-all duration-150 p-4 sm:p-5 border border-raid-border hover:border-raid-primary focus:outline-none focus-visible:ring-1 focus-visible:ring-raid-primary shadow-none"
    >
      <div>
        {/* Top Row: Category Tag + Platform + Campaign Status + Priority Pin */}
        <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-border-default">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="inline-flex items-center gap-1 rounded-md border border-raid-border bg-raid-bg px-2.5 py-1 font-mono text-[11px] font-semibold text-raid-text">
              <Sparkles className="w-3 h-3 text-raid-primary" />
              <span>SOCIAL RAID</span>
            </span>

            {/* Campaign Status (Section 4.4) */}
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-mono text-[10px] font-black uppercase tracking-wider ${
                isCompleted
                  ? 'bg-surface-card border border-border-default text-muted'
                  : isPaused
                  ? 'bg-amber/15 text-amber border border-amber/40'
                  : isExpired
                  ? 'bg-danger/20 text-danger border border-danger/40'
                  : 'bg-raid-bg text-raid-text border border-raid-border'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  isCompleted
                    ? 'bg-muted'
                    : isPaused
                    ? 'bg-amber'
                    : isExpired
                    ? 'bg-danger'
                    : 'bg-raid-primary'
                }`}
              />
              <span>{statusLabel}</span>
            </span>

            {campaign.pinned && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-raid-strong text-white font-mono text-[10px] font-black uppercase">
                <Pin className="w-2.5 h-2.5" />
                <span>PRIORITY PIN</span>
              </span>
            )}
          </div>

          {isAdmin && (
            <div className="flex items-center gap-1.5 shrink-0 text-muted font-mono text-xs">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onTogglePin?.(campaign.id, !campaign.pinned);
                }}
                className={`px-2 py-0.5 rounded-md border text-[10px] font-mono cursor-pointer transition-colors ${
                  campaign.pinned
                    ? 'bg-raid-strong text-white border-raid-border font-black'
                    : 'bg-surface-card hover:bg-surface-3 border-border-default text-muted hover:text-white'
                }`}
                title={campaign.pinned ? 'Unpin Priority Raid' : 'Pin Raid as Priority'}
              >
                {campaign.pinned ? 'PINNED' : 'PIN'}
              </button>
            </div>
          )}
        </div>

        {/* Campaign Title & Configured Duration Row (Section 6.2) */}
        <div className="pt-3 pb-2 space-y-2">
          <div className="flex items-start justify-between gap-3">
            <h3 className="font-sans text-base font-extrabold text-white group-hover:text-raid-text transition-colors leading-tight">
              {campaign.title}
            </h3>

            {/* Configured Duration Badge ONLY (Section 6.2 - no countdowns, no closing timestamps) */}
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-surface-card border border-border-default font-mono text-xs font-bold text-muted uppercase tracking-wider shrink-0">
              <Clock className="w-3 h-3 text-raid-primary" />
              <span>{configuredDuration}</span>
            </span>
          </div>

          <p className="font-sans text-xs text-muted leading-relaxed line-clamp-3">
            {campaign.description}
          </p>

          {/* Action pills: e.g. Like, Retweet, Quote */}
          {campaign.targetActions && campaign.targetActions.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap pt-1">
              {campaign.targetActions.map((action, i) => (
                <span
                  key={i}
                  className="px-2 py-0.5 rounded-md bg-surface-card border border-border-default text-[10px] font-mono font-semibold text-muted"
                >
                  ✓ {action}
                </span>
              ))}
            </div>
          )}

          {/* Primary Action Button: Open X Tweet */}
          <a
            href={campaign.tweetUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-between w-full h-11 min-h-[44px] px-3.5 rounded-lg bg-surface-card hover:bg-surface-3 border border-border-default hover:border-raid-border text-white font-sans text-xs font-bold transition-colors mt-2"
          >
            <span className="flex items-center gap-2">
              <Twitter className="w-4 h-4 text-raid-primary" />
              <span>View Raid Post on X</span>
            </span>
            <ExternalLink className="w-3.5 h-3.5 text-raid-primary" />
          </a>
        </div>

        {/* Reward Callout Banner */}
        <div className="my-2 p-3 rounded-lg bg-surface-card border border-raid-border/40 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <Sparkles className="w-4 h-4 text-raid-primary shrink-0" />
            <div>
              <div className="font-sans text-[10px] font-bold text-muted uppercase tracking-wider">
                AIRDROP REWARD PER USER
              </div>
              <div className="font-sans text-sm font-black text-raid-primary">
                {campaign.rewardAmount}
              </div>
            </div>
          </div>
          {campaign.totalPool && (
            <div className="text-right">
              <div className="font-sans text-[10px] font-bold text-muted uppercase tracking-wider">
                TOTAL POOL
              </div>
              <div className="font-mono text-xs font-bold text-white">
                {campaign.totalPool}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Bottom Area: Submission Form or Submission Status */}
      <div className="pt-3 border-t border-border-default mt-2">
        {userSubmission ? (
          /* User has already submitted */
          <div className="rounded-lg bg-surface-card border border-border-default p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs font-bold text-toxic font-sans">
                <CheckCircle2 className="w-4 h-4 text-toxic" />
                <span>Raid Proof Submitted</span>
              </span>
              <span
                className={`px-2 py-0.5 rounded-md font-mono text-[10px] font-extrabold uppercase ${
                  userSubmission.status === 'AIRDROPPED'
                    ? 'bg-toxic-bg text-toxic border border-toxic-border'
                    : 'bg-amber/15 text-amber border border-amber/40'
                }`}
              >
                {userSubmission.status === 'AIRDROPPED' ? '✓ AIRDROPPED' : 'PENDING AIRDROP'}
              </span>
            </div>

            <div className="text-[11px] font-mono space-y-1 text-muted">
              <div className="flex items-center justify-between gap-1">
                <span>X Handle:</span>
                <a
                  href={`https://x.com/${userSubmission.xHandle.replace(/^@/, '')}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-raid-primary hover:underline font-bold"
                >
                  {userSubmission.xHandle}
                </a>
              </div>
              <div className="flex items-center justify-between gap-1">
                <span>Wallet:</span>
                <button
                  type="button"
                  onClick={() => handleCopyWallet(userSubmission.walletAddress)}
                  className="inline-flex items-center gap-1 text-white hover:text-raid-primary font-mono"
                  title="Click to copy wallet"
                >
                  <span>
                    {userSubmission.walletAddress.slice(0, 4)}...
                    {userSubmission.walletAddress.slice(-4)}
                  </span>
                  {copiedWallet ? (
                    <Check className="w-3 h-3 text-toxic" />
                  ) : (
                    <Copy className="w-3 h-3 text-muted" />
                  )}
                </button>
              </div>
              {userSubmission.airdropTx && (
                <div className="flex items-center justify-between gap-1 pt-1 border-t border-border-default">
                  <span className="text-toxic">Tx Hash:</span>
                  <a
                    href={`https://solscan.io/tx/${userSubmission.airdropTx}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-raid-primary hover:underline inline-flex items-center gap-0.5"
                  >
                    <span>View Tx ↗</span>
                  </a>
                </div>
              )}
            </div>
          </div>
        ) : isCompleted || isExpired || isPaused ? (
          <div className="py-3 px-4 text-center text-xs font-sans text-muted bg-surface-card rounded-lg border border-border-default">
            {isPaused
              ? 'This raid campaign is currently paused. Submissions are temporarily closed.'
              : isExpired
              ? 'This raid campaign has expired. Submissions are closed.'
              : `This raid campaign has concluded (${statusLabel}).`}
          </div>
        ) : (
          /* Submission Form (Section 6.4) */
          <form onSubmit={handleSubmit} className="space-y-2.5">
            <div className="font-sans text-[11px] font-extrabold uppercase text-raid-primary flex items-center justify-between">
              <span>Submit Proof for Airdrop</span>
              <span className="text-muted font-normal text-[10px]">Open to All Wallets</span>
            </div>

            {/* Wallet Verification & Server Session Status Banner (Fixes A & B) */}
            {!isWalletConnected ? (
              <div className="p-2.5 rounded-lg bg-surface-card border border-border-default space-y-1.5">
                <div className="flex items-center justify-between gap-2 text-xs font-sans">
                  <span className="flex items-center gap-1.5 text-muted">
                    <Wallet className="w-3.5 h-3.5 text-raid-primary" />
                    <span>No wallet connected</span>
                  </span>
                  <button
                    type="button"
                    onClick={openConnectWalletModal}
                    className="px-2.5 py-1 min-h-[36px] rounded bg-raid-strong hover:bg-raid-primary text-white font-mono text-[11px] font-bold transition-colors cursor-pointer"
                  >
                    Connect Wallet
                  </button>
                </div>
                <p className="text-[10px] font-sans text-dim">
                  Connect your Solana wallet to sign verification proof and receive your $GENESIS airdrop.
                </p>
              </div>
            ) : !isSigningSupported ? (
              <div className="p-2.5 rounded-lg bg-danger/10 border border-danger/30 space-y-1">
                <div className="flex items-center gap-1.5 text-danger font-sans text-xs font-bold">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <span>Wallet signing unavailable</span>
                </div>
                <p className="text-[10px] font-sans text-danger/80">
                  Your connected wallet or browser adapter does not support message signing. Please connect with Phantom, Solflare, or Trust Wallet.
                </p>
              </div>
            ) : isWalletMismatched ? (
              <div className="p-2.5 rounded-lg bg-amber/10 border border-amber/30 space-y-2">
                <div className="flex items-center justify-between gap-2 text-xs font-sans">
                  <span className="flex items-center gap-1.5 text-amber font-bold">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    <span>Wallet Address Mismatch</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setWalletInput(connectedAddress || '')}
                    className="px-2 py-0.5 rounded bg-surface-card hover:bg-surface-3 border border-amber/40 text-amber font-mono text-[10px] font-bold transition-colors cursor-pointer"
                  >
                    Use Connected
                  </button>
                </div>
                <p className="text-[10px] font-sans text-muted">
                  Entered address differs from connected wallet ({connectedAddress ? `${connectedAddress.slice(0, 4)}...${connectedAddress.slice(-4)}` : ''}). Submissions must be signed by the receiving address.
                </p>
              </div>
            ) : serverSession.status === 'CHECKING' ? (
              <div className="p-2.5 rounded-lg bg-surface-card border border-border-default flex items-center justify-between gap-2 text-xs font-sans">
                <span className="flex items-center gap-1.5 text-muted">
                  <RefreshCw className="w-3.5 h-3.5 text-raid-primary animate-spin" />
                  <span>Checking server session...</span>
                </span>
                <span className="font-mono text-[10px] text-dim">
                  {connectedAddress ? `${connectedAddress.slice(0, 4)}...${connectedAddress.slice(-4)}` : ''}
                </span>
              </div>
            ) : serverSession.status === 'ERROR' ? (
              <div className="p-2.5 rounded-lg bg-danger/10 border border-danger/30 space-y-1.5">
                <div className="flex items-center justify-between gap-2 text-xs font-sans">
                  <span className="flex items-center gap-1.5 text-danger font-bold">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    <span>Session verification error</span>
                  </span>
                  <button
                    type="button"
                    disabled={authenticatingSession || submitting}
                    onClick={handleAuthenticateSession}
                    className="px-2.5 py-1 rounded bg-surface-card hover:bg-surface-3 border border-danger/40 text-white font-mono text-[11px] font-bold transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {authenticatingSession ? 'Authenticating...' : 'Retry Auth'}
                  </button>
                </div>
                <p className="text-[10px] font-sans text-danger/80">
                  {serverSession.error || 'Could not confirm server session. Re-authenticate to continue.'}
                </p>
              </div>
            ) : !isServerSessionAuthenticated ? (
              <div className="p-2.5 rounded-lg bg-surface-card border border-border-default space-y-1.5">
                <div className="flex items-center justify-between gap-2 text-xs font-sans">
                  <span className="flex items-center gap-1.5 text-muted">
                    <ShieldCheck className="w-3.5 h-3.5 text-amber" />
                    <span>Wallet connected · Authentication required</span>
                  </span>
                  <button
                    type="button"
                    disabled={authenticatingSession || submitting}
                    onClick={handleAuthenticateSession}
                    className="px-2.5 py-1 rounded bg-surface-card hover:bg-surface-3 border border-border-default text-white font-mono text-[11px] font-bold transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {authenticatingSession ? 'Authenticating...' : 'Authenticate'}
                  </button>
                </div>
                <p className="text-[10px] font-sans text-dim">
                  Sign a one-click session message to confirm wallet ownership with the server before submitting.
                </p>
              </div>
            ) : (
              <div className="p-2 rounded-md bg-toxic-bg/30 border border-toxic-border/50 flex items-center justify-between gap-2 text-[11px] font-sans">
                <span className="flex items-center gap-1.5 text-toxic font-semibold">
                  <CheckCircle2 className="w-3.5 h-3.5 text-toxic shrink-0" />
                  <span>Wallet Authenticated &amp; Ready</span>
                </span>
                <span className="font-mono text-[10px] text-muted">
                  {connectedAddress ? `${connectedAddress.slice(0, 4)}...${connectedAddress.slice(-4)}` : ''}
                </span>
              </div>
            )}

            {errorMsg && (
              <div className="p-2 rounded-md bg-danger/10 border border-danger/30 text-danger text-[11px] font-sans flex items-start gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>{errorMsg}</span>
              </div>
            )}

            {successMsg && (
              <div className="p-2 rounded-md bg-toxic-bg border border-toxic-border text-toxic text-[11px] font-sans flex items-start gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>{successMsg}</span>
              </div>
            )}

            <div className="space-y-2">
              <div>
                <div className="flex items-center justify-between pb-1">
                  <label className="text-[10px] font-mono text-muted uppercase font-bold" htmlFor={`wallet-${campaign.id}`}>
                    Solana Wallet Address
                  </label>
                  {isWalletConnected && (
                    <button
                      type="button"
                      onClick={() => handleSwitchWallet?.()}
                      className="text-[10px] font-mono text-raid-primary hover:underline cursor-pointer"
                    >
                      Switch Wallet
                    </button>
                  )}
                </div>
                <input
                  id={`wallet-${campaign.id}`}
                  type="text"
                  value={walletInput}
                  onChange={(e) => setWalletInput(e.target.value)}
                  placeholder="Your Solana wallet address..."
                  className={`w-full h-11 min-h-[44px] px-3 rounded-lg bg-surface-card border ${
                    isWalletMismatched
                      ? 'border-amber/60 focus:border-amber text-amber'
                      : 'border-border-default focus:border-raid-primary text-white'
                  } font-mono text-xs placeholder:text-dim focus:outline-none`}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className="sr-only" htmlFor={`xhandle-${campaign.id}`}>X Handle</label>
                  <input
                    id={`xhandle-${campaign.id}`}
                    type="text"
                    value={xHandleInput}
                    onChange={(e) => setXHandleInput(e.target.value)}
                    placeholder="Your @XHandle..."
                    className="w-full h-11 min-h-[44px] px-3 rounded-lg bg-surface-card border border-border-default focus:border-raid-primary font-mono text-xs text-white placeholder:text-dim focus:outline-none"
                  />
                </div>
                <div>
                  <label className="sr-only" htmlFor={`retweet-${campaign.id}`}>Retweet Link</label>
                  <input
                    id={`retweet-${campaign.id}`}
                    type="text"
                    value={retweetLinkInput}
                    onChange={(e) => setRetweetLinkInput(e.target.value)}
                    placeholder="Retweet Link URL..."
                    className="w-full h-11 min-h-[44px] px-3 rounded-lg bg-surface-card border border-border-default focus:border-raid-primary font-mono text-xs text-white placeholder:text-dim focus:outline-none"
                  />
                </div>
              </div>
            </div>

            <button
              type="submit"
              disabled={
                submitting ||
                !isWalletConnected ||
                !isSigningSupported ||
                isWalletMismatched ||
                !cleanWallet ||
                !cleanHandle ||
                !cleanRetweet
              }
              className="w-full h-11 min-h-[44px] px-4 rounded-lg bg-raid-strong hover:bg-raid-primary text-white font-sans text-xs font-black uppercase tracking-wider inline-flex items-center justify-center gap-1.5 cursor-pointer transition-colors shadow-none disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Submitting Proof...</span>
                </>
              ) : !isWalletConnected ? (
                <>
                  <Wallet className="w-3.5 h-3.5" />
                  <span>Connect Wallet to Submit</span>
                </>
              ) : !isSigningSupported ? (
                <>
                  <AlertCircle className="w-3.5 h-3.5" />
                  <span>Signing Unsupported</span>
                </>
              ) : isWalletMismatched ? (
                <>
                  <AlertCircle className="w-3.5 h-3.5 text-amber" />
                  <span>Wallet Address Mismatch</span>
                </>
              ) : (
                <>
                  <Send className="w-3.5 h-3.5" />
                  <span>Claim Raid Airdrop</span>
                </>
              )}
            </button>
          </form>
        )}
      </div>
    </article>
  );
};
