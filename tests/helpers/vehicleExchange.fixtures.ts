import { randomUUID } from 'crypto';
import { db } from '../../src/db/connection';
import { organizations } from '../../src/db/schema/organizations';
import { fleets } from '../../src/db/schema/fleets';
import { drivers } from '../../src/db/schema/drivers';
import { vehicles } from '../../src/db/schema/vehicles';
import { driverFleetMemberships } from '../../src/db/schema/driver_fleet_memberships';
import { dutySessions } from '../../src/db/schema/duty_sessions';
import { driverVehicleAssignments } from '../../src/db/schema/driver_vehicle_assignments';
import { vehicleExchangeRequests } from '../../src/db/schema/vehicle_exchange_requests';
import { vehicleExchangeEvents } from '../../src/db/schema/vehicle_exchange_events';
import { vehicleExchangeResourceLocks } from '../../src/db/schema/vehicle_exchange_resource_locks';
import { bookings } from '../../src/db/schema/bookings';
import { customers } from '../../src/db/schema/customers';
import { serviceCategories } from '../../src/db/schema/service_categories';
import { issueVehicleQrToken } from '../../src/services/vehicleQrToken.service';
import { eq, inArray, and, sql } from 'drizzle-orm';
import { queryClient } from '../../src/db/connection';

async function ensureVehicleColorColumn() {
  await queryClient`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS color varchar(50)`;
}

export interface PairedDriversFixture {
  runId: string;
  orgId: string;
  fleetId: string;
  driverAId: string;
  driverBId: string;
  vehicleAId: string;
  vehicleBId: string;
  qrTokenA: string;
  qrTokenB: string;
  dutyAId: string;
  dutyBId: string;
  assignmentAId: string;
  assignmentBId: string;
  serviceCategoryId: string;
  customerId: string;
  ids: {
    orgIds: string[];
    fleetIds: string[];
    driverIds: string[];
    vehicleIds: string[];
    dutyIds: string[];
    assignmentIds: string[];
    exchangeIds: string[];
    bookingIds: string[];
    customerIds: string[];
    serviceCategoryIds: string[];
  };
}

function uid(prefix: string) {
  return `${prefix}-${randomUUID()}`;
}

function shortBookingNumber(prefix: string) {
  return `${prefix}${randomUUID().replace(/-/g, '').slice(0, 20 - prefix.length)}`;
}

export async function createPairedDriversFixture(): Promise<PairedDriversFixture> {
  await ensureVehicleColorColumn();
  const runId = randomUUID().slice(0, 8);

  const [org] = await db
    .insert(organizations)
    .values({ name: `Exchange Test Org ${runId}`, type: 'company', status: 'active' })
    .returning();

  const [fleet] = await db
    .insert(fleets)
    .values({ organizationId: org.id, name: `Exchange Fleet ${runId}`, status: 'active' })
    .returning();

  const [vehicleA] = await db
    .insert(vehicles)
    .values({
      make: 'Toyota',
      model: 'Camry',
      plateNumber: uid('PLT-A'),
      status: 'active',
      fleetId: fleet.id,
    })
    .returning();

  const [vehicleB] = await db
    .insert(vehicles)
    .values({
      make: 'Honda',
      model: 'Accord',
      plateNumber: uid('PLT-B'),
      status: 'active',
      fleetId: fleet.id,
    })
    .returning();

  const [driverA] = await db
    .insert(drivers)
    .values({
      auth0Id: uid('auth0-a'),
      email: `${uid('a')}@exchange.test`,
      name: `Driver A ${runId}`,
      status: 'online',
      vehicleId: vehicleA.id,
    })
    .returning();

  const [driverB] = await db
    .insert(drivers)
    .values({
      auth0Id: uid('auth0-b'),
      email: `${uid('b')}@exchange.test`,
      name: `Driver B ${runId}`,
      status: 'online',
      vehicleId: vehicleB.id,
    })
    .returning();

  await db.insert(driverFleetMemberships).values([
    { driverId: driverA.id, fleetId: fleet.id, status: 'active' },
    { driverId: driverB.id, fleetId: fleet.id, status: 'active' },
  ]);

  const [dutyA] = await db
    .insert(dutySessions)
    .values({
      driverId: driverA.id,
      fleetId: fleet.id,
      organizationId: org.id,
      status: 'active',
      startVehicleId: vehicleA.id,
    })
    .returning();

  const [dutyB] = await db
    .insert(dutySessions)
    .values({
      driverId: driverB.id,
      fleetId: fleet.id,
      organizationId: org.id,
      status: 'active',
      startVehicleId: vehicleB.id,
    })
    .returning();

  const [assignmentA] = await db
    .insert(driverVehicleAssignments)
    .values({
      driverId: driverA.id,
      vehicleId: vehicleA.id,
      fleetId: fleet.id,
      dutySessionId: dutyA.id,
      isActive: true,
      assignedBy: 'test',
      assignmentReason: 'test_setup',
    })
    .returning();

  const [assignmentB] = await db
    .insert(driverVehicleAssignments)
    .values({
      driverId: driverB.id,
      vehicleId: vehicleB.id,
      fleetId: fleet.id,
      dutySessionId: dutyB.id,
      isActive: true,
      assignedBy: 'test',
      assignmentReason: 'test_setup',
    })
    .returning();

  const tokenA = await issueVehicleQrToken(vehicleA.id, fleet.id, null);
  const tokenB = await issueVehicleQrToken(vehicleB.id, fleet.id, null);

  // Reuse seeded DriveWize category — never mint economy-<uuid> orphans in shared DBs
  let serviceCategory = (
    await db
      .select()
      .from(serviceCategories)
      .where(eq(serviceCategories.code, 'economy'))
      .limit(1)
  )[0];
  const createdServiceCategoryIds: string[] = [];
  if (!serviceCategory) {
    const [created] = await db
      .insert(serviceCategories)
      .values({
        code: 'economy',
        name: 'Economy Sedan',
        baseFare: '0.00',
        perKmRate: '0.00',
        minFare: '0.00',
        capacity: 3,
        isActive: true,
        sortOrder: 1,
      })
      .returning();
    serviceCategory = created;
    createdServiceCategoryIds.push(created.id);
  }

  const [customer] = await db
    .insert(customers)
    .values({
      auth0Id: uid('cust'),
      email: `${uid('cust')}@exchange.test`,
      name: `Customer ${runId}`,
      status: 'active',
    })
    .returning();

  return {
    runId,
    orgId: org.id,
    fleetId: fleet.id,
    driverAId: driverA.id,
    driverBId: driverB.id,
    vehicleAId: vehicleA.id,
    vehicleBId: vehicleB.id,
    qrTokenA: tokenA.token,
    qrTokenB: tokenB.token,
    dutyAId: dutyA.id,
    dutyBId: dutyB.id,
    assignmentAId: assignmentA.id,
    assignmentBId: assignmentB.id,
    serviceCategoryId: serviceCategory.id,
    customerId: customer.id,
    ids: {
      orgIds: [org.id],
      fleetIds: [fleet.id],
      driverIds: [driverA.id, driverB.id],
      vehicleIds: [vehicleA.id, vehicleB.id],
      dutyIds: [dutyA.id, dutyB.id],
      assignmentIds: [assignmentA.id, assignmentB.id],
      exchangeIds: [],
      bookingIds: [],
      customerIds: [customer.id],
      serviceCategoryIds: createdServiceCategoryIds,
    },
  };
}

export async function createCrossFleetPartner(fixture: PairedDriversFixture) {
  const [fleet2] = await db
    .insert(fleets)
    .values({
      organizationId: fixture.orgId,
      name: `Other Fleet ${fixture.runId}`,
      status: 'active',
    })
    .returning();

  const [vehicleC] = await db
    .insert(vehicles)
    .values({
      make: 'Ford',
      model: 'Focus',
      plateNumber: uid('PLT-C'),
      status: 'active',
      fleetId: fleet2.id,
    })
    .returning();

  const [driverC] = await db
    .insert(drivers)
    .values({
      auth0Id: uid('auth0-c'),
      email: `${uid('c')}@exchange.test`,
      name: `Driver C ${fixture.runId}`,
      status: 'online',
      vehicleId: vehicleC.id,
    })
    .returning();

  await db.insert(driverFleetMemberships).values({
    driverId: driverC.id,
    fleetId: fleet2.id,
    status: 'active',
  });

  const [dutyC] = await db
    .insert(dutySessions)
    .values({
      driverId: driverC.id,
      fleetId: fleet2.id,
      organizationId: fixture.orgId,
      status: 'active',
      startVehicleId: vehicleC.id,
    })
    .returning();

  await db.insert(driverVehicleAssignments).values({
    driverId: driverC.id,
    vehicleId: vehicleC.id,
    fleetId: fleet2.id,
    dutySessionId: dutyC.id,
    isActive: true,
    assignedBy: 'test',
    assignmentReason: 'test_setup',
  });

  const qrTokenC = await issueVehicleQrToken(vehicleC.id, fleet2.id, null);

  fixture.ids.fleetIds.push(fleet2.id);
  fixture.ids.driverIds.push(driverC.id);
  fixture.ids.vehicleIds.push(vehicleC.id);
  fixture.ids.dutyIds.push(dutyC.id);

  return { driverCId: driverC.id, vehicleCId: vehicleC.id, qrTokenC: qrTokenC.token, fleet2Id: fleet2.id };
}

export async function insertActiveRideBooking(
  fixture: PairedDriversFixture,
  driverId: string,
  vehicleId: string,
  status = 'in_progress'
) {
  const [booking] = await db
    .insert(bookings)
    .values({
      bookingNumber: shortBookingNumber('BK'),
      customerId: fixture.customerId,
      serviceCategoryId: fixture.serviceCategoryId,
      status,
      pickupLatitude: '23.8103',
      pickupLongitude: '90.4125',
      pickupAddress: 'Test Pickup',
      dropoffLatitude: '23.8200',
      dropoffLongitude: '90.4200',
      dropoffAddress: 'Test Dropoff',
      assignedDriverId: driverId,
      assignedVehicleId: vehicleId,
    })
    .returning();
  fixture.ids.bookingIds.push(booking.id);
  return booking;
}

export async function insertCompletedHistoricalBooking(
  fixture: PairedDriversFixture,
  driverId: string,
  vehicleId: string
) {
  const [booking] = await db
    .insert(bookings)
    .values({
      bookingNumber: shortBookingNumber('H'),
      customerId: fixture.customerId,
      serviceCategoryId: fixture.serviceCategoryId,
      status: 'completed',
      pickupLatitude: '23.8103',
      pickupLongitude: '90.4125',
      pickupAddress: 'Hist Pickup',
      dropoffLatitude: '23.8200',
      dropoffLongitude: '90.4200',
      dropoffAddress: 'Hist Dropoff',
      assignedDriverId: driverId,
      assignedVehicleId: vehicleId,
      completedAt: new Date(),
    })
    .returning();
  fixture.ids.bookingIds.push(booking.id);
  return booking;
}

export async function cleanupExchangeFixture(fixture: PairedDriversFixture) {
  if (fixture.ids.bookingIds.length) {
    await db.delete(bookings).where(inArray(bookings.id, fixture.ids.bookingIds));
  }
  if (fixture.ids.exchangeIds.length) {
    await db
      .delete(vehicleExchangeEvents)
      .where(inArray(vehicleExchangeEvents.exchangeRequestId, fixture.ids.exchangeIds));
    await db
      .delete(vehicleExchangeResourceLocks)
      .where(inArray(vehicleExchangeResourceLocks.exchangeRequestId, fixture.ids.exchangeIds));
    await db
      .delete(vehicleExchangeRequests)
      .where(inArray(vehicleExchangeRequests.id, fixture.ids.exchangeIds));
  }
  await db
    .delete(driverVehicleAssignments)
    .where(inArray(driverVehicleAssignments.driverId, fixture.ids.driverIds));
  await db.delete(dutySessions).where(inArray(dutySessions.driverId, fixture.ids.driverIds));
  await db
    .delete(driverFleetMemberships)
    .where(inArray(driverFleetMemberships.driverId, fixture.ids.driverIds));
  await db.delete(drivers).where(inArray(drivers.id, fixture.ids.driverIds));
  await db.delete(vehicles).where(inArray(vehicles.id, fixture.ids.vehicleIds));
  await db.delete(fleets).where(inArray(fleets.id, fixture.ids.fleetIds));
  await db.delete(organizations).where(inArray(organizations.id, fixture.ids.orgIds));
  if (fixture.ids.customerIds.length) {
    await db.delete(customers).where(inArray(customers.id, fixture.ids.customerIds));
  }
  if (fixture.ids.serviceCategoryIds.length) {
    // Never delete seed/canonical product categories from shared environments
    await db
      .delete(serviceCategories)
      .where(
        and(
          inArray(serviceCategories.id, fixture.ids.serviceCategoryIds),
          sql`code !~* '^(economy|executive|suv|van|minivan|ada|ride|bike|cng|moto|premium|comfort)$'`
        )
      );
  }
}

export async function trackExchange(fixture: PairedDriversFixture, exchangeId: string) {
  fixture.ids.exchangeIds.push(exchangeId);
}

export async function deactivateAssignment(assignmentId: string) {
  await db
    .update(driverVehicleAssignments)
    .set({ isActive: false, unassignedAt: new Date(), unassignedReason: 'admin_override' })
    .where(eq(driverVehicleAssignments.id, assignmentId));
}
