import { resolveVehicleProfile, validateVehicleProfileForQr } from '../src/services/adminVehicleProfile.service';
import type { Vehicle } from '../src/db/schema/vehicles';

describe('adminVehicleProfile.service', () => {
  const baseVehicle = {
    id: '00000000-0000-4000-8000-000000000001',
    make: null,
    model: null,
    year: null,
    plateNumber: null,
    vin: null,
    bodyNumber: null,
    status: 'active',
    fleetId: '00000000-0000-4000-8000-000000000099',
    qrCode: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as Vehicle;

  it('resolves display fields from legacy driver hints when vehicle row is incomplete', () => {
    const profile = resolveVehicleProfile(baseVehicle, {
      make: 'Ford',
      model: 'F-160',
      plateNumber: '54321',
      color: 'Black',
      year: 2026,
      sourceDriverIds: ['driver-1'],
      ambiguous: [],
    });

    expect(profile).toEqual({
      make: 'Ford',
      model: 'F-160',
      plateNumber: '54321',
      year: 2026,
      color: 'Black',
      displayName: 'Ford F-160',
    });
  });

  it('returns safe nulls when no vehicle or legacy data exists', () => {
    const profile = resolveVehicleProfile(baseVehicle, null);
    expect(profile).toEqual({
      make: null,
      model: null,
      plateNumber: null,
      year: null,
      color: null,
      displayName: null,
    });
  });

  it('prefers vehicle table values over legacy hints', () => {
    const profile = resolveVehicleProfile(
      { ...baseVehicle, make: 'Toyota', model: 'Axio', plateNumber: 'DHA-1234', year: 2022 },
      {
        make: 'Ford',
        model: 'F-160',
        plateNumber: '54321',
        color: 'Black',
        year: 2026,
        sourceDriverIds: ['driver-1'],
        ambiguous: [],
      }
    );

    expect(profile.make).toBe('Toyota');
    expect(profile.model).toBe('Axio');
    expect(profile.plateNumber).toBe('DHA-1234');
    expect(profile.year).toBe(2022);
    expect(profile.displayName).toBe('Toyota Axio');
  });

  it('validates QR issuance requirements', () => {
    expect(
      validateVehicleProfileForQr(
        {
          make: 'Toyota',
          model: 'Axio',
          plateNumber: 'DHA-1234',
          year: 2022,
          color: 'White',
          displayName: 'Toyota Axio',
        },
        true
      ).valid
    ).toBe(true);

    const incomplete = validateVehicleProfileForQr(
      {
        make: 'Toyota',
        model: 'Axio',
        plateNumber: null,
        year: 2022,
        color: null,
        displayName: 'Toyota Axio',
      },
      false
    );
    expect(incomplete.valid).toBe(false);
    expect(incomplete.missing).toEqual(expect.arrayContaining(['plateNumber', 'serviceCategory']));
  });
});

describe('vehicleId param schema', () => {
  it('accepts vehicleId route param name', async () => {
    const { vehicleIdParamSchema } = await import('../src/validators');
    const parsed = vehicleIdParamSchema.safeParse({
      vehicleId: '281b0d60-71c9-45e3-abcd-0d7c6a590c37',
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects missing vehicleId', async () => {
    const { vehicleIdParamSchema } = await import('../src/validators');
    const parsed = vehicleIdParamSchema.safeParse({});
    expect(parsed.success).toBe(false);
  });
});
