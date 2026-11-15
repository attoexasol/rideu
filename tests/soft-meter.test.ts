import { DRAFT_SOFT_METER_RATES, METERED_CHARGING_RELEASED, unconfiguredMeterRules } from '../src/constants/softMeter';
import { millimetersToMicroMiles, previewFare } from '../src/services/softMeter/fare';
import { evaluateGpsPoint, emptyTrackState } from '../src/services/softMeter/gps';
import { beginFinalization, KeyedMutex } from '../src/services/softMeter/lifecycle';
import {
  assertChargingReleaseAllowed,
  assertScheduleEditable,
  evaluateCharging,
  materializeSnapshot,
  nextDraftVersion,
  transitionScheduleStatus,
  validateRateDefinition,
  type RateSnapshot,
} from '../src/services/softMeter/rules';
import { assertWalkUpEligible } from '../src/services/softMeter/eligibility';
import { createWalkUpTrip, type WalkUpDeps } from '../src/services/softMeter/walkUp.service';
import {
  applyPaymentSignal,
  interpretCheckoutEvent,
  onDemandSettlementView,
} from '../src/services/softMeter/paymentState';
import { MeterPaymentStatus } from '../src/constants/softMeter';
import fs from 'fs';
import path from 'path';

function errorCode(run: () => void): string | undefined {
  try {
    run();
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return undefined;
}

const ONE_MILE_MM = 1_609_344;

function draftSnapshot(overrides: Partial<RateSnapshot> = {}): RateSnapshot {
  return {
    scheduleId: 'sched-1',
    code: 'coronado_soft_meter',
    version: 1,
    status: 'draft',
    currency: DRAFT_SOFT_METER_RATES.currency,
    flagDropCents: DRAFT_SOFT_METER_RATES.flagDropCents,
    distanceRateCentsPerMile: DRAFT_SOFT_METER_RATES.distanceRateCentsPerMile,
    distanceIncrementMicroMiles: DRAFT_SOFT_METER_RATES.distanceIncrementMicroMiles,
    distanceIncrementCents: DRAFT_SOFT_METER_RATES.distanceIncrementCents,
    waitingCentsPerHour: DRAFT_SOFT_METER_RATES.waitingCentsPerHour,
    waitingCentsPerMinute: DRAFT_SOFT_METER_RATES.waitingCentsPerMinute,
    chargingEnabled: false,
    rules: unconfiguredMeterRules(),
    capturedAt: '2026-10-29T00:00:00.000Z',
    ...overrides,
  };
}

describe('soft meter fare arithmetic and rate versions', () => {
  it('keeps the client draft rates internally consistent and charging off', () => {
    expect(METERED_CHARGING_RELEASED).toBe(false);
    expect(
      validateRateDefinition({
        ...DRAFT_SOFT_METER_RATES,
        chargingEnabled: false,
        rules: unconfiguredMeterRules(),
      })
    ).toEqual([]);
    expect(DRAFT_SOFT_METER_RATES.distanceIncrementCents * 10).toBe(
      DRAFT_SOFT_METER_RATES.distanceRateCentsPerMile
    );
    expect(DRAFT_SOFT_METER_RATES.waitingCentsPerMinute * 60).toBe(
      DRAFT_SOFT_METER_RATES.waitingCentsPerHour
    );
  });

  it('prices one mile as ten 46-cent increments plus flag drop, without billing it', () => {
    expect(millimetersToMicroMiles(ONE_MILE_MM)).toBe(1_000_000);
    const fare = previewFare(draftSnapshot(), ONE_MILE_MM, 0);
    expect(fare.distanceChargeCents).toBe(460);
    expect(fare.flagDropCents).toBe(420);
    expect(fare.waitingChargeCents).toBe(0);
    expect(fare.totalCents).toBe(880);
    expect(fare.completedIncrements).toBe(10);
    expect(fare.billable).toBe(false);
    expect(fare.provisional).toBe(true);
    expect(fare.blockedReasons).toEqual(
      expect.arrayContaining([
        'METERED_CHARGING_NOT_RELEASED',
        'PARTIAL_INCREMENT_UNCONFIGURED',
        'WAITING_ELIGIBILITY_UNCONFIGURED',
        'DISTANCE_TIME_POLICY_UNCONFIGURED',
        'LOCAL_METER_NOT_APPROVED',
        'PAYMENT_AUTHORIZATION_UNCONFIGURED',
        'STOPPED_TIME_PARTIAL_MINUTE_TEST_ONLY',
      ])
    );
    const withStop = previewFare(draftSnapshot(), ONE_MILE_MM, 120);
    expect(withStop.distanceChargeCents).toBe(460);
    expect(withStop.waitingChargeCents).toBe(120);
    expect(withStop.billedStoppedMinutes).toBe(2);
    expect(withStop.unbilledStoppedRemainderSeconds).toBe(0);
    expect(withStop.totalCents).toBe(1000);
    expect(withStop.billable).toBe(false);
    expect(withStop.chargingEnabled).toBe(false);
    expect(withStop.waitingPolicyApplied).toBe('test_only_completed_minutes');
  });

  it('does not round a partial increment up while that rule is unapproved', () => {
    const almost = previewFare(draftSnapshot(), ONE_MILE_MM - 20_000, 0);
    expect(almost.completedIncrements).toBe(9);
    expect(almost.remainderMicroMiles).toBeGreaterThan(0);
    expect(almost.distanceChargeCents).toBe(414);
  });

  it('still blocks charging when rules are approved but the release latch is off', () => {
    const approved = draftSnapshot({
      chargingEnabled: true,
      rules: {
        partialIncrementRounding: 'completed_increments_only',
        waitingEligibility: 'not_charged',
        distanceTimePolicy: 'distance_only',
        localMeterApproved: true,
        paymentAuthorizationPolicy: 'setup_only_no_capture',
        speedSwitchBelow10Mph: false,
      },
    });
    expect(evaluateCharging(approved, true).billable).toBe(true);
    expect(evaluateCharging(approved, false).billable).toBe(false);
    expect(previewFare(approved, ONE_MILE_MM, 0).billable).toBe(false);
  });

  it('rejects the below-10-mph switch and refuses to enable charging', () => {
    expect(() =>
      validateRateDefinition({
        ...DRAFT_SOFT_METER_RATES,
        chargingEnabled: true,
        rules: { ...unconfiguredMeterRules(), speedSwitchBelow10Mph: true },
      })
    ).not.toThrow();
    const errors = validateRateDefinition({
      ...DRAFT_SOFT_METER_RATES,
      chargingEnabled: true,
      rules: { ...unconfiguredMeterRules(), speedSwitchBelow10Mph: true },
    });
    expect(errors).toEqual(
      expect.arrayContaining([
        'below-10-mph switching is not approved',
        'metered charging is not released',
      ])
    );
    expect(() => assertChargingReleaseAllowed()).toThrow(/Live metered charging stays disabled/);
  });

  it('versions rates without changing a snapshot already attached to a trip', () => {
    const attached = materializeSnapshot(
      {
        scheduleId: 'sched-1',
        code: 'coronado_soft_meter',
        version: 1,
        status: 'draft',
        ...DRAFT_SOFT_METER_RATES,
        chargingEnabled: false,
        rules: unconfiguredMeterRules(),
      },
      '2026-10-29T00:00:00.000Z'
    );
    const next = nextDraftVersion(attached, { flagDropCents: 500 });
    expect(attached.flagDropCents).toBe(420);
    expect(attached.version).toBe(1);
    expect(next.version).toBe(2);
    expect(next.status).toBe('draft');
    expect(next.flagDropCents).toBe(500);
    expect(errorCode(() => assertScheduleEditable({ status: 'active', sessionCount: 0 }))).toBe(
      'RATE_SCHEDULE_IMMUTABLE'
    );
    expect(errorCode(() => assertScheduleEditable({ status: 'draft', sessionCount: 1 }))).toBe(
      'RATE_SCHEDULE_IN_USE'
    );
    expect(transitionScheduleStatus('draft', 'submit')).toBe('pending_approval');
    expect(transitionScheduleStatus('pending_approval', 'approve')).toBe('approved');
    expect(transitionScheduleStatus('approved', 'activate')).toBe('active');
    expect(errorCode(() => transitionScheduleStatus('active', 'approve'))).toBe(
      'INVALID_RATE_TRANSITION'
    );
  });
});

describe('soft meter GPS reliability', () => {
  const base = {
    clientPointId: 'p1',
    latitude: 32.6859,
    longitude: -117.1831,
    accuracyMeters: 5,
    speedMps: 0,
    recordedAtMs: 1_700_000_000_000,
  };

  it('rejects a duplicate point and keeps accepted distance', () => {
    const first = evaluateGpsPoint(emptyTrackState(), base, base.recordedAtMs);
    const second = evaluateGpsPoint(first.next, { ...base, clientPointId: 'p2' }, base.recordedAtMs + 500);
    expect(first.disposition).toBe('accepted');
    expect(first.distanceDeltaMillimeters).toBe(0);
    expect(second.disposition).toBe('rejected');
    expect(second.rejectReason).toBe('duplicate');
    expect(second.next.acceptedDistanceMillimeters).toBe(0);
  });

  it('rejects out-of-order points', () => {
    const first = evaluateGpsPoint(emptyTrackState(), base, base.recordedAtMs);
    const late = evaluateGpsPoint(
      first.next,
      {
        ...base,
        clientPointId: 'old',
        latitude: base.latitude + 0.002,
        recordedAtMs: base.recordedAtMs - 5_000,
      },
      base.recordedAtMs + 1_000
    );
    expect(late.rejectReason).toBe('out_of_order');
    expect(late.next.acceptedDistanceMillimeters).toBe(first.next.acceptedDistanceMillimeters);
  });

  it('does not fabricate distance across a GPS outage', () => {
    const first = evaluateGpsPoint(emptyTrackState(), base, base.recordedAtMs);
    const afterGap = evaluateGpsPoint(
      first.next,
      {
        ...base,
        clientPointId: 'after-gap',
        latitude: base.latitude + 0.01,
        recordedAtMs: base.recordedAtMs + 31_000,
      },
      base.recordedAtMs + 31_000
    );
    expect(afterGap.disposition).toBe('accepted');
    expect(afterGap.gapBefore).toBe(true);
    expect(afterGap.distanceDeltaMillimeters).toBe(0);
    expect(afterGap.next.acceptedDistanceMillimeters).toBe(0);
    expect(afterGap.next.reviewRequired).toBe(true);
    expect(afterGap.next.reviewReasons).toContain('gps_outage');
  });

  it('rejects implausible movement inside the outage window', () => {
    const first = evaluateGpsPoint(emptyTrackState(), base, base.recordedAtMs);
    const jump = evaluateGpsPoint(
      first.next,
      {
        ...base,
        clientPointId: 'jump',
        latitude: base.latitude + 0.02,
        recordedAtMs: base.recordedAtMs + 1_000,
      },
      base.recordedAtMs + 1_000
    );
    expect(jump.rejectReason).toBe('implausible_movement');
    expect(jump.next.acceptedDistanceMillimeters).toBe(0);
    expect(jump.next.reviewReasons).toContain('implausible_movement');
  });

  it('rejects stale and low-accuracy samples', () => {
    const stale = evaluateGpsPoint(
      emptyTrackState(),
      { ...base, recordedAtMs: 1_000 },
      base.recordedAtMs
    );
    const poor = evaluateGpsPoint(
      emptyTrackState(),
      { ...base, accuracyMeters: 40 },
      base.recordedAtMs
    );
    expect(stale.rejectReason).toBe('stale');
    expect(poor.rejectReason).toBe('low_accuracy');
  });
});

describe('soft meter lifecycle and concurrency', () => {
  it('finalizes a running or stopped session once and rejects a meter that never started', () => {
    expect(beginFinalization('finalized')).toBe('return_existing');
    expect(beginFinalization('running')).toBe('stop_then_claim');
    expect(beginFinalization('stopped')).toBe('claim');
    expect(beginFinalization('pending')).toBe('reject');
    expect(beginFinalization('voided')).toBe('reject');
  });

  it('serializes concurrent finalization so the fare record is created once', async () => {
    const mutex = new KeyedMutex();
    let creates = 0;
    let fareId: string | null = null;
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        mutex.run('session-1', async () => {
          if (fareId) return { id: fareId, idempotent: true };
          await new Promise((resolve) => setTimeout(resolve, 5));
          creates += 1;
          fareId = 'fare-1';
          return { id: fareId, idempotent: false };
        })
      )
    );
    expect(creates).toBe(1);
    expect(results.every((result) => result.id === 'fare-1')).toBe(true);
    expect(results.filter((result) => result.idempotent).length).toBe(19);
  });

  it('locks the session row and stores one fare record per session', () => {
    const repository = fs.readFileSync(
      path.join(__dirname, '../src/repositories/meterSession.repository.ts'),
      'utf8'
    );
    const service = fs.readFileSync(
      path.join(__dirname, '../src/services/softMeter/meterSession.service.ts'),
      'utf8'
    );
    const migration = fs.readFileSync(
      path.join(__dirname, '../src/db/migrations/0036_soft_meter.sql'),
      'utf8'
    );
    expect(repository).toContain(".for('update')");
    expect(service).not.toContain('update(meterFareRecords)');
    expect(migration).toContain('uq_meter_fare_records_session');
    expect(migration).toContain('CHECK ("billable" = false)');
    expect(migration).toContain('CHECK ("charging_enabled" = false)');
  });
});

describe('walk-up eligibility and creation', () => {
  const allowed = {
    accountActive: true,
    dutyRequired: true,
    onDuty: true,
    vehicleId: 'vehicle-1',
    vehicleApproved: true,
    activeBooking: false,
    openWalkUp: false,
    openMeter: false,
    serviceArea: { applies: false } as const,
  };

  it('requires an eligible on-duty driver and blocks overlapping trips', () => {
    expect(() => assertWalkUpEligible(allowed)).not.toThrow();
    expect(errorCode(() => assertWalkUpEligible({ ...allowed, accountActive: false }))).toBe(
      'ACCOUNT_DEACTIVATED'
    );
    expect(errorCode(() => assertWalkUpEligible({ ...allowed, onDuty: false }))).toBe(
      'DRIVER_NOT_ON_DUTY'
    );
    expect(errorCode(() => assertWalkUpEligible({ ...allowed, vehicleApproved: false }))).toBe(
      'VEHICLE_NOT_APPROVED'
    );
    expect(errorCode(() => assertWalkUpEligible({ ...allowed, activeBooking: true }))).toBe(
      'DRIVER_BUSY'
    );
    expect(errorCode(() => assertWalkUpEligible({ ...allowed, openMeter: true }))).toBe(
      'DRIVER_BUSY'
    );
    expect(
      errorCode(() =>
        assertWalkUpEligible({
          ...allowed,
          serviceArea: { applies: true, inside: false, code: 'OUTSIDE_SERVICE_AREA' },
        })
      )
    ).toBe('OUTSIDE_SERVICE_AREA');
    expect(() =>
      assertWalkUpEligible({
        ...allowed,
        dutyRequired: false,
        onDuty: false,
        serviceArea: { applies: false },
      })
    ).not.toThrow();
  });

  it('creates one walk-up trip and replays the same idempotency key', async () => {
    const inserted: Array<Record<string, unknown>> = [];
    const deps: WalkUpDeps = {
      dutyRequired: true,
      findActiveBooking: async () => null,
      findOpenWalkUp: async () => null,
      findByIdempotency: async (key) =>
        (inserted.find((row) => row.idempotencyKey === key) as never) ?? null,
      findOpenMeter: async () => null,
      resolveVehicle: async () => ({ vehicleId: 'vehicle-1' }),
      vehicleApproved: async () => true,
      onDuty: async () => ({ onDuty: true, dutySessionId: 'duty-1' }),
      serviceArea: async () => ({ applies: false }),
      insertTrip: async (values) => {
        const trip = { id: 'trip-1', ...values };
        inserted.push(trip);
        return trip as never;
      },
      currencyForMarket: () => 'USD',
    };
    const input = {
      driverId: 'driver-1',
      accountStatus: 'active',
      legacyVehicleId: null,
      marketCode: 'US',
      pickupLatitude: 32.6859,
      pickupLongitude: -117.1831,
      idempotencyKey: 'walkup-key-001',
    };
    const created = await createWalkUpTrip(input, deps);
    const replay = await createWalkUpTrip(input, deps);
    expect(created.idempotent).toBe(false);
    expect(created.trip.vehicleId).toBe('vehicle-1');
    expect(created.trip.currency).toBe('USD');
    expect(replay.idempotent).toBe(true);
    expect(replay.trip.id).toBe(created.trip.id);
    expect(inserted).toHaveLength(1);
    await expect(
      createWalkUpTrip(input, {
        ...deps,
        findActiveBooking: async () => ({ id: 'booking-1' }),
        findByIdempotency: async () => null,
      })
    ).rejects.toMatchObject({ code: 'DRIVER_BUSY' });
  });
});

describe('meter payment state and booking settlement', () => {
  it('does not mark a trip paid when the customer returns from Checkout', () => {
    const opened = applyPaymentSignal(MeterPaymentStatus.CHECKOUT_OPEN, {
      type: 'customer_returned',
    });
    expect(opened).toEqual({
      status: MeterPaymentStatus.CHECKOUT_OPEN,
      changed: false,
      markPaid: false,
    });
    const unpaid = interpretCheckoutEvent({
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_1',
          payment_status: 'unpaid',
          metadata: { purpose: 'walk_up_meter', walkUpTripId: 'trip-1' },
        },
      },
    });
    expect(unpaid.action).toBe('ignore');
    expect(unpaid.reason).toBe('checkout_completed_unpaid');
  });

  it('marks paid only from a verified paid webhook and ignores a duplicate', () => {
    const paid = interpretCheckoutEvent({
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_1',
          payment_status: 'paid',
          payment_intent: 'pi_1',
          receipt_url: 'https://pay.stripe.com/receipts/1',
          metadata: { purpose: 'walk_up_meter', walkUpTripId: 'trip-1', fareRecordId: 'fare-1' },
        },
      },
    });
    expect(paid.action).toBe('paid');
    expect(paid.paymentIntentId).toBe('pi_1');
    const first = applyPaymentSignal(MeterPaymentStatus.CHECKOUT_OPEN, { type: 'webhook_paid' });
    const second = applyPaymentSignal(first.status, { type: 'webhook_paid' });
    expect(first.markPaid).toBe(true);
    expect(second).toEqual({ status: MeterPaymentStatus.PAID, changed: false, markPaid: false });
    const blocked = applyPaymentSignal(MeterPaymentStatus.NOT_BILLABLE, { type: 'webhook_paid' });
    expect(blocked.markPaid).toBe(false);
    expect(blocked.status).toBe(MeterPaymentStatus.NOT_BILLABLE);
  });

  it('keeps on-demand quoted settlement separate from an unapproved meter', () => {
    const view = onDemandSettlementView({
      billable: false,
      blockedReasons: ['METERED_CHARGING_NOT_RELEASED'],
    });
    expect(view.captureMeterFare).toBe(false);
    expect(view.existingQuotedFareRemains).toBe(true);
    expect(view.authorizationCanBeIncreased).toBe(false);
    expect(view.authorizationHeldIndefinitely).toBe(false);
    expect(view.finalSettlementSeparatedFromAcceptance).toBe(true);
    const payment = fs.readFileSync(
      path.join(__dirname, '../src/services/softMeter/meterPayment.service.ts'),
      'utf8'
    );
    expect(payment).not.toContain('paymentIntents.capture');
    expect(payment).not.toContain('captureAuthorizedBookingPayment');
    expect(payment).toContain('METERED_CHARGING_RELEASED');
  });
});
