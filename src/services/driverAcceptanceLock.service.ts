import { redis } from '../config/redis';

const ACCEPTING_PREFIX = 'driver:accepting:';
const DISPATCH_SUSPENDED_PREFIX = 'exchange:dispatch_suspended:';
const ACCEPTING_TTL_SECONDS = 15;

export async function setDriverAcceptingOffer(driverId: string): Promise<void> {
  await redis.setex(`${ACCEPTING_PREFIX}${driverId}`, ACCEPTING_TTL_SECONDS, '1');
}

export async function clearDriverAcceptingOffer(driverId: string): Promise<void> {
  await redis.del(`${ACCEPTING_PREFIX}${driverId}`);
}

export async function isDriverAcceptingOffer(driverId: string): Promise<boolean> {
  const val = await redis.get(`${ACCEPTING_PREFIX}${driverId}`);
  return val === '1';
}

export async function setDispatchSuspended(driverId: string, exchangeId: string): Promise<void> {
  await redis.setex(`${DISPATCH_SUSPENDED_PREFIX}${driverId}`, 3600, exchangeId);
}

export async function clearDispatchSuspended(driverId: string): Promise<void> {
  await redis.del(`${DISPATCH_SUSPENDED_PREFIX}${driverId}`);
}

export async function isDispatchSuspended(driverId: string): Promise<boolean> {
  const val = await redis.get(`${DISPATCH_SUSPENDED_PREFIX}${driverId}`);
  return val != null && val.length > 0;
}

export async function getDispatchSuspendedExchangeId(
  driverId: string
): Promise<string | null> {
  return redis.get(`${DISPATCH_SUSPENDED_PREFIX}${driverId}`);
}
