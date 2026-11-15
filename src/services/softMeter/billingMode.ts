import { TEST_ONLY_UNAPPROVED_TARIFF } from '../../constants/softMeter';
import { BookingStatus } from '../../constants/bookingStatus';
import { isCanonicalExactCode } from '../../utils/serviceCategoryNormalize';

export const BillingMode = {
  METERED_POST_TRIP: 'metered_post_trip',
  QUOTED_PREPAY: 'quoted_prepay',
} as const;

export type BillingModeType = (typeof BillingMode)[keyof typeof BillingMode];

const NOT_METERED_CODES = new Set(['rental', 'reserve']);

/**
 * Instant canonical on-demand products bill the Soft Meter after the ride.
 * Scheduled reserve rides, rentals, and legacy products keep quote prepay.
 * The client cannot choose this.
 */
export function classifyBookingBilling(input: {
  serviceCode: string;
  schedulingType: 'instant' | 'scheduled';
}): BillingModeType {
  const code = input.serviceCode.trim().toLowerCase();
  if (input.schedulingType === 'scheduled') return BillingMode.QUOTED_PREPAY;
  if (NOT_METERED_CODES.has(code) || !isCanonicalExactCode(code)) {
    return BillingMode.QUOTED_PREPAY;
  }
  return BillingMode.METERED_POST_TRIP;
}

export function planBookingCreate(input: {
  billingMode: BillingModeType;
  paymentMethodCode: string;
  isScheduled: boolean;
}): {
  billingMode: BillingModeType;
  initialStatus: string;
  createQuotePaymentIntent: boolean;
  startDispatch: boolean;
  paymentRequiredBeforeDispatch: boolean;
  paymentRequiredAfterCompletion: boolean;
  fareClassification: string | null;
} {
  const metered = input.billingMode === BillingMode.METERED_POST_TRIP;
  const card = input.paymentMethodCode === 'card';
  if (metered) {
    return {
      billingMode: BillingMode.METERED_POST_TRIP,
      initialStatus: BookingStatus.SEARCHING,
      createQuotePaymentIntent: false,
      startDispatch: true,
      paymentRequiredBeforeDispatch: false,
      paymentRequiredAfterCompletion: true,
      fareClassification: TEST_ONLY_UNAPPROVED_TARIFF,
    };
  }
  return {
    billingMode: BillingMode.QUOTED_PREPAY,
    initialStatus: input.isScheduled
      ? BookingStatus.SCHEDULED
      : card
        ? BookingStatus.QUOTED
        : BookingStatus.SEARCHING,
    createQuotePaymentIntent: card,
    startDispatch: !input.isScheduled && !card,
    paymentRequiredBeforeDispatch: card,
    paymentRequiredAfterCompletion: false,
    fareClassification: null,
  };
}

export function bookingBillingFields(
  stored: string | null | undefined,
  paymentMethodCode?: string | null
): {
  billingMode: BillingModeType;
  paymentRequiredBeforeDispatch: boolean;
  paymentRequiredAfterCompletion: boolean;
  fareClassification: string | null;
} {
  const billingMode =
    stored === BillingMode.METERED_POST_TRIP
      ? BillingMode.METERED_POST_TRIP
      : BillingMode.QUOTED_PREPAY;
  const metered = billingMode === BillingMode.METERED_POST_TRIP;
  return {
    billingMode,
    paymentRequiredBeforeDispatch: !metered && paymentMethodCode === 'card',
    paymentRequiredAfterCompletion: metered,
    fareClassification: metered ? TEST_ONLY_UNAPPROVED_TARIFF : null,
  };
}

/**
 * A stored metered booking never falls back to the quote.
 * A missing meter stays unresolved. Legacy rows still settle the quote
 * unless a meter session is already attached.
 */
export function completionSettlementPlan(input: {
  storedBillingMode: string | null | undefined;
  meterAttached: boolean;
  quoteAlreadyCaptured: boolean;
}): 'meter_test' | 'meter_unresolved' | 'capture_quote' | 'leave_historical_quote' {
  const metered = input.storedBillingMode === BillingMode.METERED_POST_TRIP || input.meterAttached;
  if (!metered) return 'capture_quote';
  if (input.quoteAlreadyCaptured) return 'leave_historical_quote';
  if (input.storedBillingMode === BillingMode.METERED_POST_TRIP && !input.meterAttached) {
    return 'meter_unresolved';
  }
  return 'meter_test';
}
