export interface SessionGateState {
  connected: boolean;
  publicKeyBase58: string | null;
  needsSignature: boolean;
  verificationState: string;
  demoEnabled: boolean;
  demoPreset: string;
}

/**
 * Allows protected session-cookie fetches only when a live connected wallet has
 * completed signature verification (whether tier resolved to VERIFIED or
 * INSUFFICIENT_MEMBERSHIP) and is NOT using a Dev Demo preset without a cookie.
 *
 * When `state` is null/undefined (e.g., standalone unit test without provider),
 * returns `fallbackWhenDetached`.
 */
export function canFetchSessionEndpoints(
  state: SessionGateState | null | undefined,
  fallbackWhenDetached = true
): boolean {
  if (!state) return fallbackWhenDetached;
  return Boolean(
    state.connected &&
      state.publicKeyBase58 &&
      !state.needsSignature &&
      (state.verificationState === 'VERIFIED' ||
        state.verificationState === 'INSUFFICIENT_MEMBERSHIP') &&
      (!state.demoEnabled || state.demoPreset === 'live')
  );
}
