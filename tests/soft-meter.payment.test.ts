import {
  METERED_CHARGING_RELEASED,
  MeterPaymentStatus,
} from '../src/constants/softMeter';
import { requestHostedMeterPayment } from '../src/services/softMeter/meterPayment.service';

const findMeterPaymentByIdempotency = jest.fn();
const insertMeterPayment = jest.fn();
const updateWalkUp = jest.fn();

jest.mock('../src/repositories/meterPayment.repository', () => ({
  findMeterPaymentByIdempotency: (...args: unknown[]) => findMeterPaymentByIdempotency(...args),
  findMeterPaymentByFare: jest.fn(),
  findMeterPaymentByCheckout: jest.fn(),
  insertMeterPayment: (...args: unknown[]) => insertMeterPayment(...args),
  updateMeterPayment: jest.fn(),
  findMeterPaymentById: jest.fn(),
  listMeterPayments: jest.fn(),
}));

jest.mock('../src/repositories/walkUp.repository', () => ({
  updateWalkUp: (...args: unknown[]) => updateWalkUp(...args),
  findWalkUpById: jest.fn(),
}));

jest.mock('../src/repositories/meterSession.repository', () => ({
  findFareBySession: jest.fn(),
  findMeterByWalkUp: jest.fn(),
}));

describe('hosted meter payment idempotency', () => {
  const fare = {
    id: 'fare-1',
    sessionId: 'session-1',
    totalCents: 880,
    currency: 'USD',
    billable: false,
    blockedReasons: ['METERED_CHARGING_NOT_RELEASED'],
  };

  beforeEach(() => {
    findMeterPaymentByIdempotency.mockReset();
    insertMeterPayment.mockReset();
    updateWalkUp.mockReset();
    updateWalkUp.mockResolvedValue(null);
  });

  it('does not call Stripe for an unapproved meter and replays the same blocked payment', async () => {
    expect(METERED_CHARGING_RELEASED).toBe(false);
    const createCheckout = jest.fn();
    findMeterPaymentByIdempotency.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'pay-1',
      status: MeterPaymentStatus.NOT_BILLABLE,
      hostedUrl: null,
    });
    insertMeterPayment.mockResolvedValue({
      id: 'pay-1',
      status: MeterPaymentStatus.NOT_BILLABLE,
    });

    await expect(
      requestHostedMeterPayment({
        subjectType: 'walk_up',
        walkUpTripId: 'trip-1',
        fare,
        currency: 'USD',
        deps: { createCheckout },
      })
    ).rejects.toMatchObject({ code: 'METER_CHARGING_DISABLED' });

    await expect(
      requestHostedMeterPayment({
        subjectType: 'walk_up',
        walkUpTripId: 'trip-1',
        fare: { ...fare, billable: true },
        currency: 'USD',
        deps: { createCheckout },
      })
    ).rejects.toMatchObject({ code: 'METER_CHARGING_DISABLED' });

    expect(createCheckout).not.toHaveBeenCalled();
    expect(insertMeterPayment).toHaveBeenCalledTimes(1);
    expect(insertMeterPayment.mock.calls[0][0].idempotencyKey).toBe('meter_checkout:fare-1');
    expect(insertMeterPayment.mock.calls[0][0].status).toBe(MeterPaymentStatus.NOT_BILLABLE);
  });

  it('returns an existing open Checkout URL without creating another session', async () => {
    const createCheckout = jest.fn();
    findMeterPaymentByIdempotency.mockResolvedValue({
      id: 'pay-1',
      status: MeterPaymentStatus.CHECKOUT_OPEN,
      hostedUrl: 'https://checkout.stripe.com/c/pay/cs_test',
    });
    const result = await requestHostedMeterPayment({
      subjectType: 'walk_up',
      walkUpTripId: 'trip-1',
      fare,
      currency: 'USD',
      deps: { createCheckout },
    });
    expect(result.idempotent).toBe(true);
    expect(result.hostedUrl).toBe('https://checkout.stripe.com/c/pay/cs_test');
    expect(createCheckout).not.toHaveBeenCalled();
    expect(insertMeterPayment).not.toHaveBeenCalled();
  });
});
