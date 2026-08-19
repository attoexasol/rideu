/**
 * Account lifecycle is separate from driver duty status (online/offline/busy).
 * Driver: drivers.account_status
 * Passenger: customers.status
 */

export const ACCOUNT_STATUS_ACTIVE = 'active';
export const ACCOUNT_STATUS_DEACTIVATED = 'deactivated';

export class AccountDeactivatedError extends Error {
  readonly code = 'ACCOUNT_DEACTIVATED';
  readonly statusCode = 403;

  constructor(message = 'This account has been deactivated') {
    super(message);
    this.name = 'AccountDeactivatedError';
  }
}

export function isDeactivatedAccount(status: string | null | undefined): boolean {
  return (status ?? '').trim().toLowerCase() === ACCOUNT_STATUS_DEACTIVATED;
}

export function assertAccountActive(status: string | null | undefined): void {
  if (isDeactivatedAccount(status)) {
    throw new AccountDeactivatedError();
  }
}
