const mockListByCustomer = jest.fn();
const mockCountByCustomer = jest.fn();
const mockListByDriver = jest.fn();
const mockCountByDriver = jest.fn();

jest.mock('../src/repositories/booking.repository', () => ({
  listRideHistoryByCustomer: (...args: unknown[]) => mockListByCustomer(...args),
  countRideHistoryByCustomer: (...args: unknown[]) => mockCountByCustomer(...args),
  listRideHistoryByDriver: (...args: unknown[]) => mockListByDriver(...args),
  countRideHistoryByDriver: (...args: unknown[]) => mockCountByDriver(...args),
}));

import { BookingStatus } from '../src/constants/bookingStatus';
import { listDriverRideHistory, listPassengerRideHistory } from '../src/services/rideHistory.service';

describe('ride history list queries', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockListByCustomer.mockResolvedValue([]);
    mockCountByCustomer.mockResolvedValue(0);
    mockListByDriver.mockResolvedValue([]);
    mockCountByDriver.mockResolvedValue(0);
  });

  it('passenger history queries only the authenticated customer', async () => {
    await listPassengerRideHistory('cust-owner', 1, 20, 'all');
    expect(mockListByCustomer).toHaveBeenCalledWith(
      'cust-owner',
      [BookingStatus.COMPLETED, BookingStatus.CANCELLED, BookingStatus.NO_DRIVERS],
      20,
      0
    );
    expect(mockCountByCustomer).toHaveBeenCalledWith('cust-owner', [
      BookingStatus.COMPLETED,
      BookingStatus.CANCELLED,
      BookingStatus.NO_DRIVERS,
    ]);
  });

  it('passenger history page 1 never queries ongoing/active statuses', async () => {
    await listPassengerRideHistory('cust-1', 1, 20, 'all');
    const statuses: string[] = mockListByCustomer.mock.calls[0][1];
    expect(statuses).not.toContain(BookingStatus.SEARCHING);
    expect(statuses).not.toContain(BookingStatus.IN_PROGRESS);
    expect(statuses).not.toContain(BookingStatus.DRIVER_EN_ROUTE);
  });

  it('passenger completed history queries completed only', async () => {
    await listPassengerRideHistory('cust-1', 1, 20, 'completed');
    expect(mockListByCustomer.mock.calls[0][1]).toEqual([BookingStatus.COMPLETED]);
  });

  it('passenger cancelled history includes no_drivers', async () => {
    await listPassengerRideHistory('cust-1', 1, 20, 'cancelled');
    expect(mockListByCustomer.mock.calls[0][1]).toEqual([
      BookingStatus.CANCELLED,
      BookingStatus.NO_DRIVERS,
    ]);
  });

  it('passenger pagination uses offset = (page-1)*limit', async () => {
    await listPassengerRideHistory('cust-1', 3, 20, 'all');
    expect(mockListByCustomer).toHaveBeenCalledWith(
      'cust-1',
      expect.any(Array),
      20,
      40
    );
  });

  it('driver history queries only the authenticated assigned driver', async () => {
    await listDriverRideHistory('driver-owner', 1, 20, 'all');
    expect(mockListByDriver).toHaveBeenCalledWith(
      'driver-owner',
      [BookingStatus.COMPLETED, BookingStatus.CANCELLED],
      20,
      0
    );
  });

  it('driver history excludes active, unassigned, and no_drivers', async () => {
    await listDriverRideHistory('driver-1', 1, 20, 'all');
    const statuses: string[] = mockListByDriver.mock.calls[0][1];
    expect(statuses).not.toContain(BookingStatus.ACCEPTED);
    expect(statuses).not.toContain(BookingStatus.DRIVER_EN_ROUTE);
    expect(statuses).not.toContain(BookingStatus.ARRIVED);
    expect(statuses).not.toContain(BookingStatus.IN_PROGRESS);
    expect(statuses).not.toContain(BookingStatus.SEARCHING);
    expect(statuses).not.toContain(BookingStatus.OFFERED);
    expect(statuses).not.toContain(BookingStatus.SCHEDULED);
    expect(statuses).not.toContain(BookingStatus.NO_DRIVERS);
  });

  it('driver completed history queries completed only', async () => {
    await listDriverRideHistory('driver-1', 1, 20, 'completed');
    expect(mockListByDriver.mock.calls[0][1]).toEqual([BookingStatus.COMPLETED]);
  });

  it('driver cancelled history queries cancelled only', async () => {
    await listDriverRideHistory('driver-1', 1, 20, 'cancelled');
    expect(mockListByDriver.mock.calls[0][1]).toEqual([BookingStatus.CANCELLED]);
  });

  it('driver pagination uses offset = (page-1)*limit', async () => {
    await listDriverRideHistory('driver-1', 2, 10, 'all');
    expect(mockListByDriver).toHaveBeenCalledWith('driver-1', expect.any(Array), 10, 10);
  });

  it('does not look up pending offers for history collection', async () => {
    await listDriverRideHistory('driver-1', 1, 20, 'all');
    expect(Object.keys(jest.requireMock('../src/repositories/booking.repository'))).not.toContain(
      'findPendingOfferForDriver'
    );
  });
});
