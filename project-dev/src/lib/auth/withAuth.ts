import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthSession, type AuthSession } from '@/server/auth';
import { clientIp, rateLimit } from '@/server/ratelimit';

export class AuthError extends Error {
  readonly status = 401;
  readonly code = 'unauthorized';

  constructor(message = 'Session required') {
    super(message);
    this.name = 'AuthError';
  }
}

export class RateLimitError extends Error {
  readonly status = 429;
  readonly code = 'rate_limited';
  readonly retryAfter: number;

  constructor(retryAfter: number, message = 'Too many requests') {
    super(message);
    this.name = 'RateLimitError';
    this.retryAfter = Math.max(1, Math.ceil(retryAfter));
  }
}

export class ValidationError extends Error {
  readonly status = 400;
  readonly code = 'bad_request';
  readonly issues: z.core.$ZodIssue[];

  constructor(message: string, issues: z.core.$ZodIssue[] = []) {
    super(message);
    this.name = 'ValidationError';
    this.issues = issues;
  }
}

export interface RouteRateLimitConfig {
  prefix: string;
  limit: number;
  windowSec: number;
  keyBy?: (req: Request) => string;
}

export interface RouteAuthDeps {
  getAuthSession?: (req: Request) => Promise<AuthSession | null>;
  rateLimit?: (
    key: string,
    limit: number,
    windowSec: number
  ) => Promise<{ ok: boolean; retryAfter: number }>;
  clientIp?: (req: Request) => string;
}

export interface WithRouteAuthOptions<TSchema extends z.ZodTypeAny | undefined = undefined> {
  schema?: TSchema;
  invalidBodyMessage?: string;
  rateLimit?: RouteRateLimitConfig;
  headers?: HeadersInit;
  deps?: RouteAuthDeps;
}

export interface AuthenticatedRouteContext<TInput = undefined> {
  req: Request;
  session: AuthSession;
  input: TInput;
}

/**
 * Validates raw data against a Zod schema and throws `ValidationError` on failure.
 */
export function parseWithSchema<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  raw: unknown,
  fallbackMessage = 'Invalid request payload'
): z.infer<TSchema> {
  const result = schema.safeParse(raw);
  if (!result.success) {
    const firstIssue = result.error.issues[0];
    const message = fallbackMessage || firstIssue?.message || 'Invalid request payload';
    throw new ValidationError(message, result.error.issues);
  }
  return result.data;
}

/**
 * Converts known route wrapper errors into consistent JSON responses.
 */
export function routeErrorToResponse(
  err: unknown,
  baseHeaders?: HeadersInit
): NextResponse {
  if (err instanceof RateLimitError) {
    const headers = new Headers(baseHeaders);
    headers.set('Retry-After', String(err.retryAfter));
    return NextResponse.json(
      { error: err.code, message: err.message, retryAfter: err.retryAfter },
      { status: err.status, headers }
    );
  }
  if (err instanceof AuthError) {
    return NextResponse.json(
      { error: err.code, message: err.message },
      { status: err.status, headers: baseHeaders }
    );
  }
  if (err instanceof ValidationError) {
    return NextResponse.json(
      { error: err.code, message: err.message },
      { status: err.status, headers: baseHeaders }
    );
  }
  throw err;
}

/**
 * Wraps a Next.js App Router handler with Upstash/memory rate limiting,
 * verified cookie/signed-wallet authentication (`getAuthSession`), and optional
 * Zod JSON payload validation.
 */
export function withRouteAuth<
  TReq extends Request = Request,
  TSchema extends z.ZodTypeAny | undefined = undefined,
>(
  handler: (
    ctx: AuthenticatedRouteContext<
      TSchema extends z.ZodTypeAny ? z.infer<TSchema> : undefined
    > & { req: TReq }
  ) => Promise<Response> | Response,
  options: WithRouteAuthOptions<TSchema> = {}
) {
  const resolveSession = options.deps?.getAuthSession ?? getAuthSession;
  const checkLimit = options.deps?.rateLimit ?? rateLimit;
  const extractIp = options.deps?.clientIp ?? clientIp;

  return async (req: TReq): Promise<Response> => {
    try {
      if (options.rateLimit) {
        const keySuffix = options.rateLimit.keyBy
          ? options.rateLimit.keyBy(req)
          : `ip:${extractIp(req)}`;
        const rl = await checkLimit(
          `${options.rateLimit.prefix}:${keySuffix}`,
          options.rateLimit.limit,
          options.rateLimit.windowSec
        );
        if (!rl.ok) {
          throw new RateLimitError(rl.retryAfter);
        }
      }

      const session = await resolveSession(req);
      if (!session) {
        throw new AuthError('Session required');
      }

      let input = undefined as TSchema extends z.ZodTypeAny ? z.infer<TSchema> : undefined;
      if (options.schema) {
        const rawBody = await req.json().catch(() => null);
        input = parseWithSchema(
          options.schema,
          rawBody,
          options.invalidBodyMessage ?? 'Invalid request payload'
        ) as TSchema extends z.ZodTypeAny ? z.infer<TSchema> : undefined;
      }

      return await handler({ req, session, input });
    } catch (err) {
      if (
        err instanceof RateLimitError ||
        err instanceof AuthError ||
        err instanceof ValidationError
      ) {
        return routeErrorToResponse(err, options.headers);
      }
      throw err;
    }
  };
}
