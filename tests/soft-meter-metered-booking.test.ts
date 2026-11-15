import fs from 'fs';
import path from 'path';
import { METERED_CHARGING_RELEASED } from '../src/constants/softMeter';
import { BookingStatus } from '../src/constants/bookingStatus';
import {
  BillingMode,
  bookingBillingFields,
  classifyBookingBilling,
  completionSettlementPlan,
  planBookingCreate,
} from '../src/services/softMeter/billingMode';

const root = path.join(__dirname, '..');

function read(relative: string): string {
  return fs.readFileSync(path.join(root, relative), 'utf8');
}

describe('metered on-demand booking without upfront authorization', () => {
  it('classifies instant canonical products as post-trip metered and leaves other products on quote prepay', () => {
    for (const code of ['economy', 'executive', 'suv', 'van', 'minivan', 'ada']) {
      expect(
        classifyBookingBilling({ serviceCode: code, schedulingType: 'instant' })
      ).toBe(BillingMode.METERED_POST_TRIP);
    }
    expect(
      classifyBookingBilling({ serviceCode: 'ECONOMY', schedulingType: 'instant' })
    ).toBe(BillingMode.METERED_POST_TRIP);
    expect(classifyBookingBilling({ serviceCode: 'rental', schedulingType: 'instant' })).toBe(
      BillingMode.QUOTED_PREPAY
    );
    expect(classifyBookingBilling({ serviceCode: 'reserve', schedulingType: 'instant' })).toBe(
      BillingMode.QUOTED_PREPAY
    );
    expect(classifyBookingBilling({ serviceCode: 'premium', schedulingType: 'instant' })).toBe(
      BillingMode.QUOTED_PREPAY
    );
    expect(classifyBookingBilling({ serviceCode: 'economy', schedulingType: 'scheduled' })).toBe(
      BillingMode.QUOTED_PREPAY
    );
  });

  it('plans a metered booking as searching, unpaid, and free of a quote PaymentIntent', () => {
    const plan = planBookingCreate({
      billingMode: BillingMode.METERED_POST_TRIP,
      paymentMethodCode: 'card',
      isScheduled: false,
    });
    expect(plan).toMatchObject({
      initialStatus: BookingStatus.SEARCHING,
      createQuotePaymentIntent: false,
      startDispatch: true,
      paymentRequiredBeforeDispatch: false,
      paymentRequiredAfterCompletion: true,
      fareClassification: 'test_only_unapproved_tariff',
    });
    expect(
      planBookingCreate({
        billingMode: BillingMode.QUOTED_PREPAY,
        paymentMethodCode: 'card',
        isScheduled: false,
      })
    ).toMatchObject({
      initialStatus: BookingStatus.QUOTED,
      createQuotePaymentIntent: true,
      startDispatch: false,
      paymentRequiredBeforeDispatch: true,
      paymentRequiredAfterCompletion: false,
    });
    expect(
      planBookingCreate({
        billingMode: BillingMode.QUOTED_PREPAY,
        paymentMethodCode: 'card',
        isScheduled: true,
      }).initialStatus
    ).toBe(BookingStatus.SCHEDULED);
    expect(
      planBookingCreate({
        billingMode: BillingMode.QUOTED_PREPAY,
        paymentMethodCode: 'cash',
        isScheduled: false,
      })
    ).toMatchObject({
      initialStatus: BookingStatus.SEARCHING,
      createQuotePaymentIntent: false,
      startDispatch: true,
    });
  });

  it('keeps a missing meter unresolved and does not fall back to the quote', () => {
    expect(
      completionSettlementPlan({
        storedBillingMode: BillingMode.METERED_POST_TRIP,
        meterAttached: false,
        quoteAlreadyCaptured: false,
      })
    ).toBe('meter_unresolved');
    expect(
      completionSettlementPlan({
        storedBillingMode: BillingMode.METERED_POST_TRIP,
        meterAttached: true,
        quoteAlreadyCaptured: false,
      })
    ).toBe('meter_test');
    expect(
      completionSettlementPlan({
        storedBillingMode: BillingMode.METERED_POST_TRIP,
        meterAttached: true,
        quoteAlreadyCaptured: true,
      })
    ).toBe('leave_historical_quote');
    expect(
      completionSettlementPlan({
        storedBillingMode: null,
        meterAttached: false,
        quoteAlreadyCaptured: false,
      })
    ).toBe('capture_quote');
    expect(
      completionSettlementPlan({
        storedBillingMode: BillingMode.QUOTED_PREPAY,
        meterAttached: false,
        quoteAlreadyCaptured: false,
      })
    ).toBe('capture_quote');
  });

  it('exposes billing flags without treating a stored null row as a new metered ride', () => {
    expect(bookingBillingFields(null, 'card')).toEqual({
      billingMode: BillingMode.QUOTED_PREPAY,
      paymentRequiredBeforeDispatch: true,
      paymentRequiredAfterCompletion: false,
      fareClassification: null,
    });
    expect(bookingBillingFields(BillingMode.METERED_POST_TRIP, 'card')).toEqual({
      billingMode: BillingMode.METERED_POST_TRIP,
      paymentRequiredBeforeDispatch: false,
      paymentRequiredAfterCompletion: true,
      fareClassification: 'test_only_unapproved_tariff',
    });
    expect(bookingBillingFields(BillingMode.QUOTED_PREPAY, 'cash').paymentRequiredBeforeDispatch).toBe(
      false
    );
  });

  it('skips quote authorization for stored metered bookings and starts the meter with the ride', () => {
    const booking = read('src/services/booking.service.ts');
    const confirm = booking.slice(
      booking.indexOf('export async function confirmBooking'),
      booking.indexOf('export async function updateBookingStatusByDriver')
    );
    expect(confirm).toContain('classifyBookingBilling');
    expect(confirm).toContain('plan.createQuotePaymentIntent');
    expect(confirm).toContain('plan.startDispatch');
    expect(confirm).toContain("paymentStatus: 'pending'");
    expect(confirm).toContain(
      "paymentCode === 'card' && booking.billingMode !== BillingMode.METERED_POST_TRIP"
    );
    expect(confirm).not.toContain('paymentIntents.capture');
    expect(confirm).not.toContain("paymentStatus: 'paid'");

    const complete = booking.slice(booking.indexOf('export async function updateBookingStatusByDriver'));
    expect(complete).toContain('startOnDemandMeter');
    expect(complete).toContain('markMeterSettlementUnresolved');
    expect(complete).toContain('ensureOnDemandMeterSettlement');
    expect(complete).toContain('isCard && !metered');
    expect(complete).toContain('!isCard && !metered');
    expect(complete).not.toContain('paymentIntents.capture');

    const controller = read('src/controllers/passengerBooking.controller.ts');
    const paymentHandler = controller.slice(controller.indexOf('export async function getBookingPaymentHandler'));
    const meteredReturn = paymentHandler.indexOf("booking.billingMode === 'metered_post_trip'");
    const prepare = paymentHandler.indexOf('prepareCardPaymentForBooking');
    expect(meteredReturn).toBeGreaterThan(-1);
    expect(prepare).toBeGreaterThan(meteredReturn);
    expect(paymentHandler).toContain('clientSecret: null');
    expect(paymentHandler).toContain('paymentIntentId: null');
  });

  it('adds an additive billing column and does not rewrite historical rows', () => {
    const sql = read('src/db/migrations/0040_metered_post_trip_billing.sql');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS "billing_mode"');
    expect(sql).not.toMatch(/UPDATE\s+"bookings"/i);
    expect(sql).not.toContain('DROP TABLE');
    const journal = read('src/db/migrations/meta/_journal.json');
    expect(journal).toContain('"tag": "0040_metered_post_trip_billing"');
    expect(journal).toContain('"idx": 39');
  });

  it('keeps production metered charging off and leaves walk-up checkout on its own purpose', () => {
    expect(METERED_CHARGING_RELEASED).toBe(false);
    const constants = read('src/constants/softMeter.ts');
    expect(constants).toContain('METERED_CHARGING_RELEASED = false');
    expect(constants).toContain("WALK_UP_TEST: 'walk_up_meter_test'");
    expect(constants).toContain("ON_DEMAND_TEST: 'on_demand_meter_test'");
    const walkUp = read('src/services/softMeter/testPayment.ts');
    expect(walkUp).toContain('evaluateWalkUpStripeTestConfig');
    expect(walkUp).not.toContain('paymentIntents.capture');
    const quotes = read('src/services/fare.service.ts');
    expect(quotes).toContain('billingMode: billing.billingMode');
    expect(quotes).toContain("cat.code === 'rental'");
  });
});
