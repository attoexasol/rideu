/**
 * Best-effort JWT identity attachment for rate-limit keying.
 * Runs before the global limiter so authenticated traffic can use
 * stable identity keys instead of a shared NAT IP bucket.
 *
 * Does NOT enforce authentication — invalid/missing tokens simply leave
 * identity unset and the limiter falls back to IP.
 */

import type { Request, Response, NextFunction } from 'express';
import { verifyBearerToken } from '../utils/jwt-verifier';

export interface RateLimitIdentity {
  userId: string;
  role: string;
  auth0Id?: string;
}

declare global {
  namespace Express {
    interface Request {
      rateLimitIdentity?: RateLimitIdentity;
    }
  }
}

function normalizeRole(raw: unknown): string {
  if (typeof raw !== 'string' || !raw) return 'user';
  if (raw === 'customer') return 'passenger';
  return raw;
}

function extractIdentity(payload: Record<string, unknown>): RateLimitIdentity | undefined {
  const nested =
    payload.payload && typeof payload.payload === 'object'
      ? (payload.payload as Record<string, unknown>)
      : payload;

  const userId =
    (typeof nested.userId === 'string' && nested.userId) ||
    (typeof nested.sub === 'string' && nested.sub) ||
    (typeof nested.auth0Id === 'string' && nested.auth0Id) ||
    undefined;

  if (!userId) return undefined;

  let role =
    (typeof nested.role === 'string' && nested.role) ||
    (typeof nested['https://drivewize.com/role'] === 'string' &&
      nested['https://drivewize.com/role']) ||
    (typeof nested.userType === 'string' && nested.userType) ||
    undefined;

  if (!role && Array.isArray(nested['https://drivewize.com/roles'])) {
    const first = nested['https://drivewize.com/roles'][0];
    if (typeof first === 'string') role = first;
  }

  return {
    userId,
    role: normalizeRole(role),
    auth0Id:
      (typeof nested.auth0Id === 'string' && nested.auth0Id) ||
      (typeof nested.sub === 'string' && nested.sub) ||
      undefined,
  };
}

/**
 * Attaches verified Bearer identity for rate limiting when present.
 * Never rejects the request.
 */
export async function attachRateLimitIdentity(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    next();
    return;
  }

  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    next();
    return;
  }

  try {
    const payload = await verifyBearerToken(token);
    const identity = extractIdentity(payload);
    if (identity) {
      // Rate-limit keying only — does not populate req.user or satisfy requireAuth.
      req.rateLimitIdentity = identity;
    }
  } catch {
    // Invalid token → IP fallback for rate limiting; route auth still enforces later.
  }

  next();
}
