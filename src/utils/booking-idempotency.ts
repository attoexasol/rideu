export function scopeCancelIdempotencyKey(bookingId: string, clientKey: string): string {
  return `cancel:${bookingId}:${clientKey}`;
}
