import fs from 'fs';
import path from 'path';
import { BookingStatus } from '../src/constants/bookingStatus';

function readSrc(relPath: string) {
  return fs.readFileSync(path.join(__dirname, '..', relPath), 'utf8');
}

describe('passenger FCM ride-event integration contract', () => {
  it('registers passenger_push_tokens migration in the journal', () => {
    const journal = JSON.parse(readSrc('src/db/migrations/meta/_journal.json')) as {
      entries: { tag: string }[];
    };
    expect(journal.entries.some((e) => e.tag === '0026_passenger_push_tokens')).toBe(true);
    expect(
      fs.existsSync(path.join(__dirname, '..', 'src/db/migrations/0026_passenger_push_tokens.sql'))
    ).toBe(true);
    const sql = readSrc('src/db/migrations/0026_passenger_push_tokens.sql');
    expect(sql).toContain('passenger_push_tokens');
    expect(sql).toContain('customer_id');
    expect(sql).not.toContain('driver_push_tokens');
  });

  it('registers authenticated passenger push-token routes', () => {
    const v1 = readSrc('src/routes/v1/index.ts');
    const push = readSrc('src/routes/v1/passenger/push.ts');
    expect(v1).toContain("router.use('/passenger/push-token', passengerPushRoutes)");
    expect(push).toContain('requireAuth');
    expect(push).toContain('extractUserInfo');
    expect(push).toContain('requireCustomer');
    expect(push).toContain('router.put(');
    expect(push).toContain('router.delete(');
  });

  it('does not reuse driver_push_tokens for passengers', () => {
    const schema = readSrc('src/db/schema/passenger_push_tokens.ts');
    expect(schema).toContain('passenger_push_tokens');
    expect(schema).toContain('customerId');
    expect(schema).not.toContain('driverId');
    const repo = readSrc('src/repositories/passengerPushToken.repository.ts');
    expect(repo).not.toContain('driver_push_tokens');
    expect(repo).not.toContain('driverPushTokens');
    expect(repo).toContain('deletePassengerPushTokensByFcmTokenExcept');
  });

  it('invalidates passenger push targets on logout and deactivation', () => {
    const auth = readSrc('src/services/passengerAuth.service.ts');
    expect(auth).toContain('onPassengerSessionReplaced');
    expect(auth).toContain('invalidatePassengerPushTargets');
    const profile = readSrc('src/services/profile.service.ts');
    expect(profile).toContain('invalidatePassengerPushTargets');
  });

  it('schedules driver_en_route push after accept commit and booking:accepted socket', () => {
    const src = readSrc('src/services/dispatch.service.ts');
    const acceptStart = src.indexOf('export async function acceptBookingOffer');
    const acceptBody = src.slice(acceptStart);
    const txEnd = acceptBody.indexOf('// --- Side effects after commit');
    const txBlock = acceptBody.slice(0, txEnd);
    const postTx = acceptBody.slice(txEnd);
    expect(txBlock).not.toContain('notifyPassengerOfRideEvent');
    expect(postTx).toContain("emitToCustomer(booking.customerId, 'booking:accepted'");
    const socketAt = postTx.indexOf("emitToCustomer(booking.customerId, 'booking:accepted'");
    const pushAt = postTx.indexOf('notifyPassengerOfRideEvent');
    expect(pushAt).toBeGreaterThan(socketAt);
    expect(postTx).toContain('event: BookingStatus.DRIVER_EN_ROUTE');
    expect(postTx).not.toContain("event: 'accepted'");
    expect(postTx).not.toContain('event: BookingStatus.ACCEPTED');
  });

  it('keeps existing booking:accepted socket payload fields', () => {
    const src = readSrc('src/services/dispatch.service.ts');
    expect(src).toContain("emitToCustomer(booking.customerId, 'booking:accepted'");
    expect(src).toContain('etaMinutes: etaMin');
    expect(src).toContain('plateNumber');
  });

  it('schedules arrived/in_progress/completed push after booking:status', () => {
    const src = readSrc('src/services/booking.service.ts');
    const fnStart = src.indexOf('export async function updateBookingStatusByDriver');
    const fnEnd = src.indexOf('export async function cancelBookingByDriver');
    const body = src.slice(fnStart, fnEnd);
    const emitAt = body.indexOf('emitBookingStatus');
    const pushAt = body.indexOf('notifyPassengerOfRideEvent');
    expect(emitAt).toBeGreaterThan(-1);
    expect(pushAt).toBeGreaterThan(emitAt);
    expect(body).toContain('BookingStatus.ARRIVED');
    expect(body).toContain('BookingStatus.IN_PROGRESS');
    expect(body).toContain('BookingStatus.COMPLETED');
  });

  it('schedules driver cancel push after booking:status', () => {
    const src = readSrc('src/services/booking.service.ts');
    const fnStart = src.indexOf('export async function cancelBookingByDriver');
    const body = src.slice(fnStart);
    const emitAt = body.indexOf('emitBookingStatus');
    const pushAt = body.indexOf('notifyPassengerOfRideEvent');
    expect(pushAt).toBeGreaterThan(emitAt);
    expect(body).toContain("cancelledBy: 'driver'");
    expect(body).toContain('BookingStatus.CANCELLED');
  });

  it('does not push for passenger self-cancel in this phase', () => {
    const src = readSrc('src/services/booking.service.ts');
    const fnStart = src.indexOf('export async function cancelBookingByCustomer');
    const fnEnd = src.indexOf('export async function consentRecording');
    const body = src.slice(fnStart, fnEnd);
    expect(body).toContain('emitBookingStatus');
    expect(body).not.toContain('notifyPassengerOfRideEvent');
  });

  it('schedules no_drivers after booking:expired on both terminal paths', () => {
    const src = readSrc('src/services/dispatch.service.ts');
    const expiredMatches = src.split("emitToCustomer(booking.customerId, 'booking:expired'");
    expect(expiredMatches.length).toBeGreaterThanOrEqual(3);
    expect(src).toContain("event: BookingStatus.NO_DRIVERS");
    const firstExpired = src.indexOf("emitToCustomer(booking.customerId, 'booking:expired'");
    const secondExpired = src.indexOf(
      "emitToCustomer(booking.customerId, 'booking:expired'",
      firstExpired + 1
    );
    expect(src.indexOf('notifyPassengerOfRideEvent', firstExpired)).toBeGreaterThan(firstExpired);
    expect(src.indexOf('notifyPassengerOfRideEvent', secondExpired)).toBeGreaterThan(secondExpired);
  });

  it('does not push searching batches', () => {
    const src = readSrc('src/services/dispatch.service.ts');
    const searchingAt = src.indexOf("emitToCustomer(booking.customerId, 'booking:searching'");
    expect(searchingAt).toBeGreaterThan(-1);
    const afterSearching = src.slice(searchingAt, searchingAt + 400);
    expect(afterSearching).not.toContain('notifyPassengerOfRideEvent');
  });

  it('does not push driver location or DVR events', () => {
    expect(readSrc('src/services/bookingNotify.service.ts')).not.toContain(
      'notifyPassengerOfRideEvent'
    );
    expect(readSrc('src/websocket/handlers/location.ts')).not.toContain('notifyPassengerOfRideEvent');
    expect(readSrc('src/services/rideVideo.service.ts')).not.toContain('notifyPassengerOfRideEvent');
  });

  it('isolates FCM from booking transactions', () => {
    const notify = readSrc('src/services/passengerRideNotify.service.ts');
    expect(notify).toContain('schedulePassengerRidePush');
    expect(notify).toContain('ISOLATED_EXCEPTION');
    const dispatch = readSrc('src/services/dispatch.service.ts');
    const txStart = dispatch.indexOf('withTransactionTimeout(async (tx)');
    const txEnd = dispatch.indexOf('// --- Side effects after commit');
    expect(dispatch.slice(txStart, txEnd)).not.toContain('notifyPassengerOfRideEvent');
  });

  it('keeps Driver FCM offer path unchanged', () => {
    const notifySrc = readSrc('src/services/driverOfferNotify.service.ts');
    expect(notifySrc).toContain("emitToDriver(input.driverId, 'booking:offer'");
    expect(notifySrc).toContain('scheduleDriverOfferPush');
    expect(notifySrc).not.toContain('notifyPassengerOfRideEvent');
  });

  it('uses committed booking statuses as event values', () => {
    expect(BookingStatus.DRIVER_EN_ROUTE).toBe('driver_en_route');
    expect(BookingStatus.ARRIVED).toBe('arrived');
    expect(BookingStatus.IN_PROGRESS).toBe('in_progress');
    expect(BookingStatus.COMPLETED).toBe('completed');
    expect(BookingStatus.CANCELLED).toBe('cancelled');
    expect(BookingStatus.NO_DRIVERS).toBe('no_drivers');
  });
});
