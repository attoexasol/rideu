/**
 * Development rate-limit diagnostics tests.
 */

import type { Request } from 'express';
import {
  flushRateLimitDebugCounts,
  inferKeyType,
  isRateLimitDebugEnabled,
  maskRateLimitKey,
  resetRateLimitDebugCounters,
  resolveUserRole,
} from '../src/middleware/rate-limit-debug';

function mockReq(partial: Partial<Request> & { user?: any } = {}): Request {
  return {
    method: partial.method ?? 'GET',
    path: partial.path ?? '/',
    headers: partial.headers ?? {},
    ...partial,
    user: partial.user,
  } as Request;
}

describe('rate-limit-debug helpers', () => {
  const savedNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = savedNodeEnv;
    resetRateLimitDebugCounters();
  });

  it('masks IP and user keys without exposing full identifiers', () => {
    expect(maskRateLimitKey('ip:192.168.1.42')).toBe('ip:192.168.1.***');
    expect(maskRateLimitKey('customer:88683ab3-01d8-47af-a52f-c45363a43fa0')).toBe(
      'customer:8868…3fa0'
    );
    expect(maskRateLimitKey('driver:11111111-1111-1111-1111-111111111111')).toBe(
      'driver:1111…1111'
    );
  });

  it('infers key types from key prefixes', () => {
    expect(inferKeyType('customer:abc')).toBe('customer');
    expect(inferKeyType('driver:abc')).toBe('driver');
    expect(inferKeyType('auth:passenger:abc')).toBe('authenticated');
    expect(inferKeyType('ip:1.2.3.4')).toBe('ip');
    expect(inferKeyType('cancel:user:booking')).toBe('customer+booking');
  });

  it('maps user roles for debug output', () => {
    expect(resolveUserRole(mockReq({ user: { role: 'customer' } }))).toBe('passenger');
    expect(resolveUserRole(mockReq({ user: { role: 'driver' } }))).toBe('driver');
    expect(resolveUserRole(mockReq())).toBe('unknown');
  });

  it('enables debug only in development tier', () => {
    process.env.NODE_ENV = 'development';
    expect(isRateLimitDebugEnabled()).toBe(true);
    process.env.NODE_ENV = 'production';
    expect(isRateLimitDebugEnabled()).toBe(false);
  });

  it('flushes endpoint counters without throwing', () => {
    flushRateLimitDebugCounts();
    resetRateLimitDebugCounters();
  });
});
