import 'dotenv/config';
import { randomUUID } from 'crypto';
import { db } from '../src/db/connection';
import { drivers } from '../src/db/schema/drivers';
import { dutySessions } from '../src/db/schema/duty_sessions';
import { driverVehicleAssignments } from '../src/db/schema/driver_vehicle_assignments';
import { vehicleExchangeRequests } from '../src/db/schema/vehicle_exchange_requests';
import { eq, and } from 'drizzle-orm';
import {
  initiateVehicleExchange,
  confirmVehicleExchange,
  cancelVehicleExchange,
  expireVehicleExchange,
  getCurrentVehicleExchange,
  VehicleExchangeError,
} from '../src/services/vehicleExchange.service';
import { resolveDispatchVehicle } from '../src/services/driverAvailability.service';
import {
  isDispatchSuspended,
  clearDispatchSuspended,
  setDriverAcceptingOffer,
  clearDriverAcceptingOffer,
} from '../src/services/driverAcceptanceLock.service';
import { bookings } from '../src/db/schema/bookings';
import { vehicles } from '../src/db/schema/vehicles';
import { findActiveAssignmentByDriverId } from '../src/repositories/driverVehicleAssignment.repository';
import { hasActiveResourceLock } from '../src/repositories/vehicleExchange.repository';
import { LOCK_RESOURCE_DRIVER, LOCK_RESOURCE_VEHICLE } from '../src/config/exchange';
import {
  createPairedDriversFixture,
  createCrossFleetPartner,
  insertActiveRideBooking,
  insertCompletedHistoricalBooking,
  cleanupExchangeFixture,
  trackExchange,
  deactivateAssignment,
  type PairedDriversFixture,
} from './helpers/vehicleExchange.fixtures';

jest.mock('../src/services/vehicleExchangeNotify.service', () => ({
  emitExchangeRequested: jest.fn().mockResolvedValue(undefined),
  emitExchangeCancelled: jest.fn().mockResolvedValue(undefined),
  emitExchangeExpired: jest.fn().mockResolvedValue(undefined),
  emitExchangeCompleted: jest.fn().mockResolvedValue(undefined),
  emitVehicleAssignmentChanged: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/services/bookingNotify.service', () => ({
  emitOfferCancelled: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/config/redis', () => {
  const store = new Map<string, string>();
  return {
    redis: {
      setex: jest.fn(async (key: string, _ttl: number, val: string) => {
        store.set(key, val);
      }),
      get: jest.fn(async (key: string) => store.get(key) ?? null),
      del: jest.fn(async (key: string) => {
        store.delete(key);
      }),
    },
    realtimeCache: {
      setDriverStatus: jest.fn().mockResolvedValue(undefined),
      getDriverStatus: jest.fn().mockResolvedValue('online'),
      getDriverLocation: jest.fn().mockResolvedValue({
        latitude: 23.81,
        longitude: 90.41,
        timestamp: new Date().toISOString(),
      }),
      getDriverHeartbeat: jest.fn().mockResolvedValue(new Date().toISOString()),
    },
  };
});

const hasDatabase = Boolean(process.env.DATABASE_URL);

async function fullSwap(fixture: PairedDriversFixture, idempotencyKey = randomUUID()) {
  const initiated = await initiateVehicleExchange({
    initiatorDriverId: fixture.driverAId,
    scannedVehicleQrToken: fixture.qrTokenB,
    idempotencyKey,
    location: { latitude: 23.81, longitude: 90.41 },
  });
  await trackExchange(fixture, initiated.exchange.id);
  const confirmed = await confirmVehicleExchange({
    exchangeId: initiated.exchange.id,
    partnerDriverId: fixture.driverBId,
    scannedVehicleQrToken: fixture.qrTokenA,
    location: { latitude: 23.81, longitude: 90.41 },
  });
  return { initiated, confirmed };
}

/** Cleanup that never masks a failed beforeEach (undefined fixture). */
async function teardownExchangeFixture(
  fixture: PairedDriversFixture | undefined,
  options: { clearLocks?: boolean } = {}
) {
  if (!fixture) {
    return;
  }
  if (options.clearLocks !== false) {
    await clearDispatchSuspended(fixture.driverAId);
    await clearDispatchSuspended(fixture.driverBId);
    await clearDriverAcceptingOffer(fixture.driverAId);
    await clearDriverAcceptingOffer(fixture.driverBId);
  }
  await cleanupExchangeFixture(fixture);
}

(describe as typeof describe | jest.EmptyFunction)(
  hasDatabase ? 'vehicle exchange integration' : 'vehicle exchange integration (skipped)',
  () => {
    if (!hasDatabase) {
      it.skip('requires DATABASE_URL', () => {});
      return;
    }

    jest.setTimeout(60_000);

    describe('happy path and invariants', () => {
      let fixture: PairedDriversFixture;

      beforeEach(async () => {
        fixture = await createPairedDriversFixture();
      });

      afterEach(async () => {
        await teardownExchangeFixture(fixture);
      });

      it('1. normal A/B exchange succeeds', async () => {
        const { confirmed } = await fullSwap(fixture);
        expect(confirmed.exchange.status).toBe('completed');
      });

      it('2. assignments swap exactly once', async () => {
        const { initiated } = await fullSwap(fixture);
        const allAssignments = await db
          .select()
          .from(driverVehicleAssignments)
          .where(
            and(
              eq(driverVehicleAssignments.exchangeRequestId, initiated.exchange.id),
              eq(driverVehicleAssignments.isActive, true)
            )
          );
        expect(allAssignments).toHaveLength(2);
        const byDriver = Object.fromEntries(allAssignments.map((a) => [a.driverId, a.vehicleId]));
        expect(byDriver[fixture.driverAId]).toBe(fixture.vehicleBId);
        expect(byDriver[fixture.driverBId]).toBe(fixture.vehicleAId);
      });

      it('3. both duty sessions remain active', async () => {
        await fullSwap(fixture);
        const duties = await db
          .select()
          .from(dutySessions)
          .where(eq(dutySessions.status, 'active'));
        const activeForPair = duties.filter(
          (d) => d.driverId === fixture.driverAId || d.driverId === fixture.driverBId
        );
        expect(activeForPair).toHaveLength(2);
      });

      it('4. drivers.vehicle_id synchronized', async () => {
        await fullSwap(fixture);
        const rows = await db
          .select()
          .from(drivers)
          .where(eq(drivers.id, fixture.driverAId));
        const rowsB = await db
          .select()
          .from(drivers)
          .where(eq(drivers.id, fixture.driverBId));
        expect(rows[0]?.vehicleId).toBe(fixture.vehicleBId);
        expect(rowsB[0]?.vehicleId).toBe(fixture.vehicleAId);
      });

      it('5. historical booking vehicle unchanged', async () => {
        const hist = await insertCompletedHistoricalBooking(
          fixture,
          fixture.driverAId,
          fixture.vehicleAId
        );
        await fullSwap(fixture);
        const [after] = await db.select().from(bookings).where(eq(bookings.id, hist.id));
        expect(after.assignedVehicleId).toBe(fixture.vehicleAId);
      });
    });

    describe('validation guards', () => {
      let fixture: PairedDriversFixture;

      beforeEach(async () => {
        fixture = await createPairedDriversFixture();
      });

      afterEach(async () => {
        await teardownExchangeFixture(fixture, { clearLocks: false });
      });

      it('6. initiator scans own vehicle rejected', async () => {
        await expect(
          initiateVehicleExchange({
            initiatorDriverId: fixture.driverAId,
            scannedVehicleQrToken: fixture.qrTokenA,
            idempotencyKey: randomUUID(),
          })
        ).rejects.toMatchObject({ code: 'CANNOT_SWAP_OWN_VEHICLE' });
      });

      it('7. cross-fleet rejected', async () => {
        const partner = await createCrossFleetPartner(fixture);
        await expect(
          initiateVehicleExchange({
            initiatorDriverId: fixture.driverAId,
            scannedVehicleQrToken: partner.qrTokenC,
            idempotencyKey: randomUUID(),
          })
        ).rejects.toMatchObject({ code: 'FLEET_MISMATCH' });
      });

      it('8. active ride blocks initiation', async () => {
        await insertActiveRideBooking(fixture, fixture.driverAId, fixture.vehicleAId);
        await expect(
          initiateVehicleExchange({
            initiatorDriverId: fixture.driverAId,
            scannedVehicleQrToken: fixture.qrTokenB,
            idempotencyKey: randomUUID(),
          })
        ).rejects.toMatchObject({ code: 'ACTIVE_RIDE_BLOCKS_EXCHANGE' });
      });
    });

    describe('concurrency and races', () => {
      let fixture: PairedDriversFixture;

      beforeEach(async () => {
        fixture = await createPairedDriversFixture();
      });

      afterEach(async () => {
        await teardownExchangeFixture(fixture);
      });

      it('9. active ride appears between initiate and confirm', async () => {
        const initiated = await initiateVehicleExchange({
          initiatorDriverId: fixture.driverAId,
          scannedVehicleQrToken: fixture.qrTokenB,
          idempotencyKey: randomUUID(),
        });
        await trackExchange(fixture, initiated.exchange.id);
        await insertActiveRideBooking(fixture, fixture.driverBId, fixture.vehicleBId);
        await expect(
          confirmVehicleExchange({
            exchangeId: initiated.exchange.id,
            partnerDriverId: fixture.driverBId,
            scannedVehicleQrToken: fixture.qrTokenA,
          })
        ).rejects.toMatchObject({ code: 'ACTIVE_RIDE_BLOCKS_EXCHANGE' });
      });

      it('10. two initiators attempt to use the same partner', async () => {
        const [vehicleC] = await db
          .insert(vehicles)
          .values({
            make: 'Mazda',
            model: '3',
            plateNumber: `PLT-C10-${randomUUID()}`,
            status: 'active',
            fleetId: fixture.fleetId,
          })
          .returning();
        fixture.ids.vehicleIds.push(vehicleC.id);

        const [driverC] = await db
          .insert(drivers)
          .values({
            auth0Id: `auth0-c2-${randomUUID()}`,
            email: `c2-${randomUUID()}@exchange.test`,
            name: 'Driver C2',
            status: 'online',
            vehicleId: vehicleC.id,
          })
          .returning();
        fixture.ids.driverIds.push(driverC.id);

        const [dutyC] = await db
          .insert(dutySessions)
          .values({
            driverId: driverC.id,
            fleetId: fixture.fleetId,
            organizationId: fixture.orgId,
            status: 'active',
            startVehicleId: vehicleC.id,
          })
          .returning();
        fixture.ids.dutyIds.push(dutyC.id);

        await db.insert(driverVehicleAssignments).values({
          driverId: driverC.id,
          vehicleId: vehicleC.id,
          fleetId: fixture.fleetId,
          dutySessionId: dutyC.id,
          isActive: true,
        });

        const initiatedA = await initiateVehicleExchange({
          initiatorDriverId: fixture.driverAId,
          scannedVehicleQrToken: fixture.qrTokenB,
          idempotencyKey: randomUUID(),
        });
        await trackExchange(fixture, initiatedA.exchange.id);

        await expect(
          initiateVehicleExchange({
            initiatorDriverId: driverC.id,
            scannedVehicleQrToken: fixture.qrTokenB,
            idempotencyKey: randomUUID(),
          })
        ).rejects.toMatchObject({ code: 'EXCHANGE_ALREADY_PENDING' });
      });

      it('11. same driver as initiator in one and partner in another blocked', async () => {
        const initiatedAB = await initiateVehicleExchange({
          initiatorDriverId: fixture.driverAId,
          scannedVehicleQrToken: fixture.qrTokenB,
          idempotencyKey: randomUUID(),
        });
        await trackExchange(fixture, initiatedAB.exchange.id);

        const [vehicleC] = await db
          .insert(vehicles)
          .values({
            make: 'Nissan',
            model: 'Altima',
            plateNumber: `PLT-X-${randomUUID()}`,
            status: 'active',
            fleetId: fixture.fleetId,
          })
          .returning();
        fixture.ids.vehicleIds.push(vehicleC.id);

        const [driverC] = await db
          .insert(drivers)
          .values({
            auth0Id: `auth0-x-${randomUUID()}`,
            email: `x-${randomUUID()}@exchange.test`,
            name: 'Driver X',
            status: 'online',
            vehicleId: vehicleC.id,
          })
          .returning();
        fixture.ids.driverIds.push(driverC.id);

        const [dutyC] = await db
          .insert(dutySessions)
          .values({
            driverId: driverC.id,
            fleetId: fixture.fleetId,
            organizationId: fixture.orgId,
            status: 'active',
            startVehicleId: vehicleC.id,
          })
          .returning();
        fixture.ids.dutyIds.push(dutyC.id);

        await db.insert(driverVehicleAssignments).values({
          driverId: driverC.id,
          vehicleId: vehicleC.id,
          fleetId: fixture.fleetId,
          dutySessionId: dutyC.id,
          isActive: true,
        });

        await expect(
          initiateVehicleExchange({
            initiatorDriverId: driverC.id,
            scannedVehicleQrToken: fixture.qrTokenB,
            idempotencyKey: randomUUID(),
          })
        ).rejects.toMatchObject({ code: 'EXCHANGE_ALREADY_PENDING' });

        expect(await hasActiveResourceLock(LOCK_RESOURCE_DRIVER, fixture.driverBId)).toBe(true);
      });

      it('12. same vehicle in opposite role in another exchange blocked', async () => {
        const initiated = await initiateVehicleExchange({
          initiatorDriverId: fixture.driverAId,
          scannedVehicleQrToken: fixture.qrTokenB,
          idempotencyKey: randomUUID(),
        });
        await trackExchange(fixture, initiated.exchange.id);

        expect(await hasActiveResourceLock(LOCK_RESOURCE_VEHICLE, fixture.vehicleBId)).toBe(true);
      });

      it('13. duplicate initiate idempotency', async () => {
        const key = randomUUID();
        const first = await initiateVehicleExchange({
          initiatorDriverId: fixture.driverAId,
          scannedVehicleQrToken: fixture.qrTokenB,
          idempotencyKey: key,
        });
        await trackExchange(fixture, first.exchange.id);
        const second = await initiateVehicleExchange({
          initiatorDriverId: fixture.driverAId,
          scannedVehicleQrToken: fixture.qrTokenB,
          idempotencyKey: key,
        });
        expect(second.idempotent).toBe(true);
        expect(second.exchange.id).toBe(first.exchange.id);
      });

      it('14. duplicate confirm idempotency', async () => {
        const initiated = await initiateVehicleExchange({
          initiatorDriverId: fixture.driverAId,
          scannedVehicleQrToken: fixture.qrTokenB,
          idempotencyKey: randomUUID(),
        });
        await trackExchange(fixture, initiated.exchange.id);
        const first = await confirmVehicleExchange({
          exchangeId: initiated.exchange.id,
          partnerDriverId: fixture.driverBId,
          scannedVehicleQrToken: fixture.qrTokenA,
        });
        const second = await confirmVehicleExchange({
          exchangeId: initiated.exchange.id,
          partnerDriverId: fixture.driverBId,
          scannedVehicleQrToken: fixture.qrTokenA,
        });
        expect(first.idempotent).toBe(false);
        expect(second.idempotent).toBe(true);
      });

      it('15. confirm vs expire race produces exactly one outcome', async () => {
        const initiated = await initiateVehicleExchange({
          initiatorDriverId: fixture.driverAId,
          scannedVehicleQrToken: fixture.qrTokenB,
          idempotencyKey: randomUUID(),
        });
        await trackExchange(fixture, initiated.exchange.id);

        await db
          .update(vehicleExchangeRequests)
          .set({ expiresAt: new Date(Date.now() - 1000) })
          .where(eq(vehicleExchangeRequests.id, initiated.exchange.id));

        const [confirmResult, expired] = await Promise.allSettled([
          confirmVehicleExchange({
            exchangeId: initiated.exchange.id,
            partnerDriverId: fixture.driverBId,
            scannedVehicleQrToken: fixture.qrTokenA,
          }),
          expireVehicleExchange(initiated.exchange.id),
        ]);

        const [row] = await db
          .select()
          .from(vehicleExchangeRequests)
          .where(eq(vehicleExchangeRequests.id, initiated.exchange.id));

        const terminalStatuses = ['completed', 'expired'];
        expect(terminalStatuses).toContain(row.status);

        const oneSucceeded =
          (confirmResult.status === 'fulfilled' && !confirmResult.value.idempotent) ||
          (expired.status === 'fulfilled' && expired.value === true);
        expect(oneSucceeded).toBe(true);
      });

      it('16. confirm vs cancel race produces exactly one outcome', async () => {
        const initiated = await initiateVehicleExchange({
          initiatorDriverId: fixture.driverAId,
          scannedVehicleQrToken: fixture.qrTokenB,
          idempotencyKey: randomUUID(),
        });
        await trackExchange(fixture, initiated.exchange.id);

        const results = await Promise.allSettled([
          confirmVehicleExchange({
            exchangeId: initiated.exchange.id,
            partnerDriverId: fixture.driverBId,
            scannedVehicleQrToken: fixture.qrTokenA,
          }),
          cancelVehicleExchange(initiated.exchange.id, fixture.driverAId, 'changed_mind'),
        ]);

        const [row] = await db
          .select()
          .from(vehicleExchangeRequests)
          .where(eq(vehicleExchangeRequests.id, initiated.exchange.id));

        expect(['completed', 'cancelled']).toContain(row.status);
        const fulfilled = results.filter((r) => r.status === 'fulfilled');
        expect(fulfilled.length).toBeGreaterThanOrEqual(1);
      });

      it('17. admin assignment change before confirm', async () => {
        const initiated = await initiateVehicleExchange({
          initiatorDriverId: fixture.driverAId,
          scannedVehicleQrToken: fixture.qrTokenB,
          idempotencyKey: randomUUID(),
        });
        await trackExchange(fixture, initiated.exchange.id);
        await deactivateAssignment(fixture.assignmentBId);
        await expect(
          confirmVehicleExchange({
            exchangeId: initiated.exchange.id,
            partnerDriverId: fixture.driverBId,
            scannedVehicleQrToken: fixture.qrTokenA,
          })
        ).rejects.toMatchObject({ code: 'ASSIGNMENT_CHANGED' });
      });

      it('18. booking accept vs exchange initiation race', async () => {
        await setDriverAcceptingOffer(fixture.driverAId);
        await expect(
          initiateVehicleExchange({
            initiatorDriverId: fixture.driverAId,
            scannedVehicleQrToken: fixture.qrTokenB,
            idempotencyKey: randomUUID(),
          })
        ).rejects.toMatchObject({ code: 'BOOKING_ACCEPTANCE_IN_PROGRESS' });
      });
    });

    describe('post-commit side effects', () => {
      let fixture: PairedDriversFixture;

      beforeEach(async () => {
        fixture = await createPairedDriversFixture();
      });

      afterEach(async () => {
        await teardownExchangeFixture(fixture, { clearLocks: false });
      });

      it('19. redis/socket failure after commit does not roll back swap', async () => {
        const notify = await import('../src/services/vehicleExchangeNotify.service');
        (notify.emitExchangeCompleted as jest.Mock).mockRejectedValueOnce(new Error('socket down'));

        const initiated = await initiateVehicleExchange({
          initiatorDriverId: fixture.driverAId,
          scannedVehicleQrToken: fixture.qrTokenB,
          idempotencyKey: randomUUID(),
        });
        await trackExchange(fixture, initiated.exchange.id);

        await expect(
          confirmVehicleExchange({
            exchangeId: initiated.exchange.id,
            partnerDriverId: fixture.driverBId,
            scannedVehicleQrToken: fixture.qrTokenA,
          })
        ).rejects.toThrow('socket down');

        const [row] = await db
          .select()
          .from(vehicleExchangeRequests)
          .where(eq(vehicleExchangeRequests.id, initiated.exchange.id));
        expect(row.status).toBe('completed');

        const assignA = await findActiveAssignmentByDriverId(fixture.driverAId);
        expect(assignA?.vehicle_id).toBe(fixture.vehicleBId);
      });

      it('20. dispatch reads new assigned vehicles after completion', async () => {
        await fullSwap(fixture);
        const resolvedA = await resolveDispatchVehicle(fixture.driverAId, fixture.vehicleBId);
        const resolvedB = await resolveDispatchVehicle(fixture.driverBId, fixture.vehicleAId);
        expect(resolvedA?.vehicleId).toBe(fixture.vehicleBId);
        expect(resolvedB?.vehicleId).toBe(fixture.vehicleAId);
      });
    });

    describe('dispatch suspension and current exchange', () => {
      let fixture: PairedDriversFixture;

      beforeEach(async () => {
        fixture = await createPairedDriversFixture();
      });

      afterEach(async () => {
        await teardownExchangeFixture(fixture);
      });

      it('suspends both drivers during pending exchange', async () => {
        const initiated = await initiateVehicleExchange({
          initiatorDriverId: fixture.driverAId,
          scannedVehicleQrToken: fixture.qrTokenB,
          idempotencyKey: randomUUID(),
        });
        await trackExchange(fixture, initiated.exchange.id);
        expect(await isDispatchSuspended(fixture.driverAId)).toBe(true);
        expect(await isDispatchSuspended(fixture.driverBId)).toBe(true);
        const current = await getCurrentVehicleExchange(fixture.driverBId);
        expect(current?.id).toBe(initiated.exchange.id);
        expect(current?.role).toBe('partner');
      });

      it('cancel is idempotent', async () => {
        const initiated = await initiateVehicleExchange({
          initiatorDriverId: fixture.driverAId,
          scannedVehicleQrToken: fixture.qrTokenB,
          idempotencyKey: randomUUID(),
        });
        await trackExchange(fixture, initiated.exchange.id);
        const first = await cancelVehicleExchange(initiated.exchange.id, fixture.driverAId);
        const second = await cancelVehicleExchange(initiated.exchange.id, fixture.driverAId);
        expect(first.idempotent).toBe(false);
        expect(second.idempotent).toBe(true);
      });
    });
  }
);

describe('vehicle exchange error type', () => {
  it('exposes status codes for API mapping', () => {
    expect(new VehicleExchangeError('EXCHANGE_EXPIRED', 'x', 410).statusCode).toBe(410);
    expect(new VehicleExchangeError('PARTNER_REQUIRED', 'x', 403).statusCode).toBe(403);
  });
});
