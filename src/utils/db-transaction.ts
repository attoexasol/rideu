import { sql } from 'drizzle-orm';
import { db } from '../db/connection';

export type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

const DEFAULT_TIMEOUT_MS = parseInt(process.env.DB_TRANSACTION_TIMEOUT_MS || '8000', 10);

/**
 * Runs a Drizzle transaction with a PostgreSQL statement timeout so locks fail fast
 * instead of hanging concurrent accept/cancel requests indefinitely.
 */
export async function withTransactionTimeout<T>(
  fn: (tx: DbTransaction) => Promise<T>,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql.raw(`SET LOCAL statement_timeout = ${timeoutMs}`));
    return fn(tx);
  });
}

export function isTransactionTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  return (
    msg.includes('statement timeout') ||
    msg.includes('canceling statement') ||
    msg.includes('query_canceled')
  );
}
