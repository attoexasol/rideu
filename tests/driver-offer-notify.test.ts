const mockEmitToDriver = jest.fn();
const mockSchedule = jest.fn();

jest.mock('../src/services/bookingNotify.service', () => ({
  emitToDriver: (...args: unknown[]) => mockEmitToDriver(...args),
}));

jest.mock('../src/services/driverOfferPush.service', () => ({
  scheduleDriverOfferPush: (...args: unknown[]) => mockSchedule(...args),
}));

jest.mock('../src/middleware/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

describe('notifyDriverOfPersistedOffer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEmitToDriver.mockResolvedValue(undefined);
    mockSchedule.mockImplementation(() => undefined);
  });

  it('emits socket then schedules push with the persisted offer id', async () => {
    const { notifyDriverOfPersistedOffer } = await import(
      '../src/services/driverOfferNotify.service'
    );
    const expiresAt = new Date(Date.now() + 45_000);
    await notifyDriverOfPersistedOffer({
      driverId: 'driver-1',
      bookingId: 'booking-1',
      offerId: 'offer-1',
      expiresAt,
      socketPayload: { offerId: 'offer-1', bookingId: 'booking-1' },
    });

    expect(mockEmitToDriver).toHaveBeenCalledWith('driver-1', 'booking:offer', {
      offerId: 'offer-1',
      bookingId: 'booking-1',
    });

    await new Promise((r) => setTimeout(r, 20));
    expect(mockSchedule).toHaveBeenCalledWith({
      driverId: 'driver-1',
      bookingId: 'booking-1',
      offerId: 'offer-1',
      expiresAt,
    });
  });

  it('still emits socket when push scheduling throws', async () => {
    mockSchedule.mockImplementation(() => {
      throw new Error('fcm down');
    });
    const { notifyDriverOfPersistedOffer } = await import(
      '../src/services/driverOfferNotify.service'
    );
    await notifyDriverOfPersistedOffer({
      driverId: 'driver-1',
      bookingId: 'booking-1',
      offerId: 'offer-1',
      expiresAt: new Date(Date.now() + 45_000),
      socketPayload: { offerId: 'offer-1' },
    });
    expect(mockEmitToDriver).toHaveBeenCalledTimes(1);
    await new Promise((r) => setTimeout(r, 20));
  });
});
