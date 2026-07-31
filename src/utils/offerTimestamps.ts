/**
 * Offer timestamp helpers — keep offered/expires as real UTC instants.
 */
export class OfferTimestampConfigError extends Error {
  readonly code = 'OFFER_TIMESTAMP_CONFIG_ERROR';

  constructor(message: string) {
    super(message);
    this.name = 'OfferTimestampConfigError';
  }
}

export interface OfferTimeWindow {
  offeredAt: Date;
  expiresAt: Date;
  ttlSeconds: number;
}

/**
 * Build offer window from a single clock reading so expiresAt is always after offeredAt.
 */
export function buildOfferTimeWindow(
  ttlSeconds: number,
  nowMs: number = Date.now()
): OfferTimeWindow {
  if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
    throw new OfferTimestampConfigError(
      `Invalid DISPATCH_OFFER_TIMEOUT_SECONDS: ${ttlSeconds}`
    );
  }

  const offeredAt = new Date(nowMs);
  const expiresAt = new Date(nowMs + ttlSeconds * 1000);

  assertOfferExpiryAfterOffered(offeredAt, expiresAt, ttlSeconds);

  return { offeredAt, expiresAt, ttlSeconds };
}

export function assertOfferExpiryAfterOffered(
  offeredAt: Date,
  expiresAt: Date,
  ttlSeconds?: number
): void {
  if (!(expiresAt.getTime() > offeredAt.getTime())) {
    console.error('[OfferTimestamp] configuration error', {
      code: 'OFFER_TIMESTAMP_CONFIG_ERROR',
      offeredAtIso: offeredAt.toISOString(),
      expiresAtIso: expiresAt.toISOString(),
      ttlSeconds: ttlSeconds ?? null,
      processTzOffsetMinutes: new Date().getTimezoneOffset(),
    });
    throw new OfferTimestampConfigError(
      'expiresAt must be strictly after offeredAt'
    );
  }
}

/** True when the offer expiry instant is still in the future relative to `now`. */
export function isOfferExpiryInFuture(expiresAt: Date, now: Date = new Date()): boolean {
  return expiresAt.getTime() > now.getTime();
}

/** Exact boundary: expired when expiresAt <= now. */
export function isOfferExpiredAt(expiresAt: Date, now: Date = new Date()): boolean {
  return expiresAt.getTime() <= now.getTime();
}
