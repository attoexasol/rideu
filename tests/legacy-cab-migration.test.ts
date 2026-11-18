import {
  buildMigrationProposals,
  type DriverMigrationProposal,
} from '../src/scripts/migrate-legacy-driver-cabs-to-vehicles';
import type { drivers } from '../src/db/schema/drivers';
import type { vehicles } from '../src/db/schema/vehicles';

type Driver = typeof drivers.$inferSelect;
type Vehicle = typeof vehicles.$inferSelect;

function driver(partial: Partial<Driver> & { id: string; name: string }): Driver {
  return {
    auth0Id: `auth0-${partial.id}`,
    email: `${partial.id}@test.com`,
    phone: null,
    status: 'offline',
    vehicleType: null,
    vehicleId: null,
    cabName: null,
    cabNumber: null,
    cabLicence: null,
    vehicleMake: null,
    vehicleModel: null,
    vehicleYear: null,
    vehicleColor: null,
    qrCode: null,
    vehicleQrCode: null,
    lastSeen: null,
    activeSessionId: null,
    activeDeviceId: null,
    activeDeviceInfo: null,
    lastLoginAt: null,
    profileImageUrl: null,
    accountStatus: 'active',
    stripeAccountId: null,
    stripeAccountCountry: null,
    stripeAccountStatus: null,
    stripeDetailsSubmitted: false,
    stripeChargesEnabled: false,
    stripePayoutsEnabled: false,
    stripeRequirementsCurrentlyDue: [],
    stripeRequirementsEventuallyDue: [],
    stripeOnboardingCompletedAt: null,
    stripeLastSyncedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...partial,
  };
}

function vehicle(partial: Partial<Vehicle> & { id: string }): Vehicle {
  return {
    make: null,
    model: null,
    year: null,
    color: null,
    plateNumber: null,
    vin: null,
    bodyNumber: null,
    status: 'active',
    fleetId: 'fleet-1',
    qrCode: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...partial,
  };
}

describe('migrate-legacy-driver-cabs-to-vehicles proposals', () => {
  it('skips drivers already linked to a vehicle', () => {
    const proposals = buildMigrationProposals(
      [driver({ id: 'd1', name: 'Linked', vehicleId: 'v1', cabNumber: '100' })],
      []
    );
    expect(proposals[0].proposedVehicleAction).toBe('skip_already_linked');
  });

  it('proposes create_vehicle_and_link for driver with cab number and no vehicle row', () => {
    const proposals = buildMigrationProposals(
      [
        driver({
          id: 'd2',
          name: 'Abdul',
          cabName: 'Faras Cab',
          cabNumber: '4081',
        }),
      ],
      []
    );
    expect(proposals[0]).toMatchObject({
      proposedVehicleAction: 'create_vehicle_and_link',
      proposedPlateNumber: '4081',
    } satisfies Partial<DriverMigrationProposal>);
  });

  it('links to existing vehicle when plate matches', () => {
    const proposals = buildMigrationProposals(
      [driver({ id: 'd3', name: 'Rakib', cabNumber: '54321', vehicleMake: 'Ford' })],
      [vehicle({ id: 'v-existing', plateNumber: '54321', make: 'Ford', model: 'F-160' })]
    );
    expect(proposals[0].proposedVehicleAction).toBe('link_existing_vehicle_by_plate');
    expect(proposals[0].proposedVehicleId).toBe('v-existing');
  });

  it('flags plate conflict when existing vehicle make/model differs', () => {
    const proposals = buildMigrationProposals(
      [driver({ id: 'd4', name: 'X', cabNumber: '54321', vehicleMake: 'Honda' })],
      [vehicle({ id: 'v-existing', plateNumber: '54321', make: 'Ford', model: 'F-160' })]
    );
    expect(proposals[0].proposedVehicleAction).toBe('manual_review_plate_conflict');
  });

  it('shares one vehicle when multiple drivers have the same cab number', () => {
    const proposals = buildMigrationProposals(
      [
        driver({ id: 'd5', name: 'A', cabNumber: '999' }),
        driver({ id: 'd6', name: 'B', cabNumber: '999' }),
      ],
      []
    );
    expect(proposals[0].proposedVehicleAction).toBe('create_vehicle_and_link');
    expect(proposals[1].proposedVehicleAction).toBe('share_vehicle_by_plate');
    expect(proposals[1].shareWithDriverIds).toContain('d5');
  });

  it('flags manual review when no legacy cab data exists', () => {
    const proposals = buildMigrationProposals([driver({ id: 'd7', name: 'Empty' })], []);
    expect(proposals[0].proposedVehicleAction).toBe('manual_review_no_legacy_data');
  });
});
