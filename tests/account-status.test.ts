import {
  ACCOUNT_STATUS_DEACTIVATED,
  AccountDeactivatedError,
  assertAccountActive,
  isDeactivatedAccount,
} from '../src/services/accountStatus.service';

describe('account lifecycle', () => {
  it('treats deactivated as blocked and active as allowed', () => {
    expect(isDeactivatedAccount('deactivated')).toBe(true);
    expect(isDeactivatedAccount('DEACTIVATED')).toBe(true);
    expect(isDeactivatedAccount('active')).toBe(false);
    expect(isDeactivatedAccount(null)).toBe(false);
    expect(ACCOUNT_STATUS_DEACTIVATED).toBe('deactivated');
  });

  it('assertAccountActive throws ACCOUNT_DEACTIVATED', () => {
    expect(() => assertAccountActive('active')).not.toThrow();
    try {
      assertAccountActive('deactivated');
      throw new Error('expected throw');
    } catch (error) {
      expect(error).toBeInstanceOf(AccountDeactivatedError);
      expect((error as AccountDeactivatedError).code).toBe('ACCOUNT_DEACTIVATED');
      expect((error as AccountDeactivatedError).statusCode).toBe(403);
    }
  });
});
