import {
  profilePatchSchema,
  profileDeactivateSchema,
} from '../src/validators/profile';

describe('profilePatchSchema', () => {
  it('accepts name only', () => {
    expect(profilePatchSchema.parse({ name: 'Rahim Ahmed' })).toEqual({ name: 'Rahim Ahmed' });
  });

  it('accepts phone object', () => {
    const parsed = profilePatchSchema.parse({
      phone: { countryCode: '+880', number: '1712345678' },
    });
    expect(parsed.phone).toEqual({ countryCode: '+880', number: '1712345678' });
  });

  it('accepts phone null', () => {
    expect(profilePatchSchema.parse({ phone: null })).toEqual({ phone: null });
  });

  it('rejects email', () => {
    expect(profilePatchSchema.safeParse({ email: 'a@b.com' }).success).toBe(false);
  });

  it('rejects status', () => {
    expect(profilePatchSchema.safeParse({ status: 'offline' }).success).toBe(false);
  });

  it('rejects vehicleId', () => {
    expect(profilePatchSchema.safeParse({ vehicleId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }).success).toBe(
      false
    );
  });

  it('rejects role, auth0Id, userId, driverId, customerId', () => {
    expect(profilePatchSchema.safeParse({ role: 'admin' }).success).toBe(false);
    expect(profilePatchSchema.safeParse({ auth0Id: 'auth0|x' }).success).toBe(false);
    expect(profilePatchSchema.safeParse({ userId: 'x' }).success).toBe(false);
    expect(profilePatchSchema.safeParse({ driverId: 'x' }).success).toBe(false);
    expect(profilePatchSchema.safeParse({ customerId: 'x' }).success).toBe(false);
  });

  it('rejects accountStatus', () => {
    expect(profilePatchSchema.safeParse({ accountStatus: 'deactivated' }).success).toBe(false);
  });
});

describe('profileDeactivateSchema', () => {
  it('requires confirm true', () => {
    expect(profileDeactivateSchema.safeParse({ confirm: true }).success).toBe(true);
    expect(profileDeactivateSchema.safeParse({ confirm: false }).success).toBe(false);
    expect(profileDeactivateSchema.safeParse({}).success).toBe(false);
  });
});
