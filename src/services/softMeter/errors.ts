export class MeterError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 409,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'MeterError';
  }
}

export function isUniqueViolation(error: unknown): boolean {
  const candidate = error as { code?: string; message?: string };
  return candidate.code === '23505' || (candidate.message ?? '').toLowerCase().includes('unique');
}
