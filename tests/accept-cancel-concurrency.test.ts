import {
  BookingStatus,
  CANCELLABLE_BY_PASSENGER,
} from '../src/constants/bookingStatus';
import { isTransactionTimeoutError } from '../src/utils/db-transaction';
import { BookingCancellationError } from '../src/services/booking.service';

describe('passenger cancellation policy', () => {
  it('allows cancel during searching, offered, driver_en_route, arrived', () => {
    expect(CANCELLABLE_BY_PASSENGER).toEqual(
      expect.arrayContaining([
        BookingStatus.SEARCHING,
        BookingStatus.OFFERED,
        BookingStatus.DRIVER_EN_ROUTE,
        BookingStatus.ARRIVED,
      ])
    );
  });

  it('blocks cancel during in_progress', () => {
    expect(CANCELLABLE_BY_PASSENGER).not.toContain(BookingStatus.IN_PROGRESS);
  });

  it('blocks cancel when already completed', () => {
    expect(CANCELLABLE_BY_PASSENGER).not.toContain(BookingStatus.COMPLETED);
  });

  it('returns 409 for cancellation not allowed', () => {
    const err = new BookingCancellationError(
      'BOOKING_CANCELLATION_NOT_ALLOWED',
      'This ride can no longer be cancelled.',
      409
    );
    expect(err.statusCode).toBe(409);
    expect(err.code).toBe('BOOKING_CANCELLATION_NOT_ALLOWED');
  });
});

describe('transaction timeout detection', () => {
  it('detects PostgreSQL statement timeout errors', () => {
    expect(isTransactionTimeoutError(new Error('canceling statement due to statement timeout'))).toBe(
      true
    );
    expect(isTransactionTimeoutError(new Error('something else'))).toBe(false);
  });
});

describe('acceptBookingOffer transaction safety', () => {
  it('does not call checkDriverEligibility inside db.transaction block', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(
      path.join(__dirname, '../src/services/dispatch.service.ts'),
      'utf8'
    );
    const acceptStart = source.indexOf('export async function acceptBookingOffer');
    const acceptEnd = source.indexOf('export async function rejectBookingOffer');
    const acceptBody = source.slice(acceptStart, acceptEnd);
    const txStart = acceptBody.indexOf('withTransactionTimeout(async (tx)');
    const txEnd = acceptBody.indexOf('// --- Side effects after commit');
    const txBlock = acceptBody.slice(txStart, txEnd);
    expect(txBlock).not.toContain('checkDriverEligibility');
    expect(txBlock).not.toContain('insertBookingEvent(');
    expect(txBlock).not.toContain('realtimeCache');
    expect(txBlock).not.toContain('emitToCustomer');
    expect(txBlock).not.toContain('emitToDriver');
  });

  it('runs eligibility and redis only after transaction commit', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(
      path.join(__dirname, '../src/services/dispatch.service.ts'),
      'utf8'
    );
    const acceptStart = source.indexOf('export async function acceptBookingOffer');
    const acceptEnd = source.indexOf('export async function rejectBookingOffer');
    const acceptBody = source.slice(acceptStart, acceptEnd);
    const preTx = acceptBody.slice(0, acceptBody.indexOf('withTransactionTimeout'));
    const postTx = acceptBody.slice(acceptBody.indexOf('// --- Side effects after commit'));
    expect(preTx).toContain('checkDriverEligibility');
    expect(postTx).toContain('realtimeCache.setDriverStatus');
    expect(postTx).toContain('emitToCustomer');
  });
});

describe('cancelBookingByCustomer transaction safety', () => {
  it('uses withTransactionTimeout and defers socket emissions', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(
      path.join(__dirname, '../src/services/booking.service.ts'),
      'utf8'
    );
    const fnStart = source.indexOf('export async function cancelBookingByCustomer');
    const fnEnd = source.indexOf('export async function consentRecording');
    const body = source.slice(fnStart, fnEnd);
    expect(body).toContain('withTransactionTimeout');
    expect(body).toContain('emitOfferCancelled');
    const txStart = body.indexOf('withTransactionTimeout(async (tx)');
    const txEnd = body.indexOf('if (!didCancel)');
    const txBlock = body.slice(txStart, txEnd);
    expect(txBlock).not.toContain('emitBookingStatus');
    expect(txBlock).not.toContain('emitOfferCancelled');
    expect(txBlock).toContain("update(drivers)");
  });
});

describe('accept conflict codes', () => {
  it('uses BOOKING_ALREADY_CANCELLED for cancelled bookings', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(
      path.join(__dirname, '../src/services/dispatch.service.ts'),
      'utf8'
    );
    expect(source).toContain("'BOOKING_ALREADY_CANCELLED'");
    expect(source).toContain("'BOOKING_NOT_AVAILABLE'");
  });
});
