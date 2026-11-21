'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from '@/lib/ui/toast';

export interface OptimisticActionOptions<TArgs, TResult> {
  /** Applies the optimistic state change and optionally returns a rollback callback. */
  applyOptimistic: (args: TArgs) => (() => void) | void;
  /** Executes the async mutation. Returning/rejecting controls rollback. */
  run: (args: TArgs) => Promise<TResult>;
  onSuccess?: (result: TResult, args: TArgs) => void;
  onError?: (error: Error, args: TArgs) => void;
  errorMessage?: string | ((error: Error) => string);
  notifyOnError?: boolean;
}

/**
 * Pure state-transition executor usable inside React hooks and headless Node tests.
 */
export async function executeOptimisticTransition<TArgs, TResult>(
  args: TArgs,
  options: Pick<OptimisticActionOptions<TArgs, TResult>, 'applyOptimistic' | 'run' | 'onSuccess' | 'onError'>
): Promise<{ ok: true; value: TResult } | { ok: false; error: Error }> {
  const rollback = options.applyOptimistic(args);

  try {
    const value = await options.run(args);
    options.onSuccess?.(value, args);
    return { ok: true, value };
  } catch (err) {
    try {
      if (typeof rollback === 'function') {
        rollback();
      }
    } finally {
      const error = err instanceof Error ? err : new Error(String(err));
      options.onError?.(error, args);
    }
    return {
      ok: false,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

/**
 * Executes an async mutation with optimistic update, automatic rollback on error,
 * in-flight tracking, and optional `sonner` error toast.
 */
export function useOptimisticAction<TArgs = void, TResult = void>(
  options: OptimisticActionOptions<TArgs, TResult>
) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useRef(true);
  const optionsRef = useRef(options);

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const resetError = useCallback(() => {
    if (mountedRef.current) setError(null);
  }, []);

  const execute = useCallback(async (args: TArgs): Promise<TResult | undefined> => {
    if (mountedRef.current) {
      setPending(true);
      setError(null);
    }

    const current = optionsRef.current;
    const result = await executeOptimisticTransition(args, {
      applyOptimistic: current.applyOptimistic,
      run: current.run,
      onSuccess: current.onSuccess,
      onError: current.onError,
    });

    if (mountedRef.current) {
      setPending(false);
    }

    if (result.ok) {
      return result.value;
    }

    if (mountedRef.current) {
      setError(result.error);
    }
    if (current.notifyOnError !== false) {
      const message =
        typeof current.errorMessage === 'function'
          ? current.errorMessage(result.error)
          : current.errorMessage ?? result.error.message;
      toast.error(message);
    }
    return undefined;
  }, []);

  return { execute, pending, error, resetError };
}
