import fs from 'fs';
import path from 'path';
import { isOfferExpiredAt } from '../src/utils/offerTimestamps';
import { BookingOfferStatus } from '../src/constants/bookingStatus';

function readSrc(relPath: string) {
  return fs.readFileSync(path.join(__dirname, '..', relPath), 'utf8');
}

describe('driver FCM dispatch integration contract', () => {
  it('triggers push only after createPendingBookingOffer in startDispatch', () => {
    const src = readSrc('src/services/dispatch.service.ts');
    const persist = src.indexOf('createPendingBookingOffer');
    const notify = src.indexOf('notifyDriverOfPersistedOffer');
    expect(persist).toBeGreaterThan(-1);
    expect(notify).toBeGreaterThan(-1);
    expect(notify).toBeGreaterThan(persist);
    expect(src).toContain('offerId: offer.id');
    expect(src).toContain('expiresAt: offerExpiresAt');
  });

  it('does not replace Socket.IO booking:offer delivery', () => {
    const notifySrc = readSrc('src/services/driverOfferNotify.service.ts');
    expect(notifySrc).toContain("emitToDriver(input.driverId, 'booking:offer'");
    expect(notifySrc).toContain('scheduleDriverOfferPush');
  });

  it('registers authenticated push-token routes', () => {
    const v1 = readSrc('src/routes/v1/index.ts');
    const push = readSrc('src/routes/v1/driver/push.ts');
    expect(v1).toContain("router.use('/driver/push-token', driverPushRoutes)");
    expect(push).toContain('requireAuth');
    expect(push).toContain('extractUserInfo');
    expect(push).toContain('requireDriver');
    expect(push).toContain("router.put(");
    expect(push).toContain("router.delete(");
  });

  it('keeps REST pending recovery routes', () => {
    const src = readSrc('src/routes/v1/driver/bookings.ts');
    expect(src).toContain("'/offers/pending'");
    expect(src).toContain("'/offers/:offerId'");
    expect(src).toContain('listPendingOffersHandler');
    expect(src).toContain('getOfferHandler');
  });

  it('keeps accept expiry semantics', () => {
    const src = readSrc('src/services/dispatch.service.ts');
    expect(src).toContain('isOfferExpiredAt(offerRow.expiresAt)');
    expect(src).toContain("'OFFER_EXPIRED'");
    expect(isOfferExpiredAt(new Date(Date.now() - 1))).toBe(true);
    expect(BookingOfferStatus.EXPIRED).toBe('expired');
  });

  it('sends booking_offer with APNs alert while keeping Android data-only', () => {
    const payload = readSrc('src/services/driverOfferPush.payload.ts');
    const service = readSrc('src/services/driverOfferPush.service.ts');
    const fcm = readSrc('src/config/fcm.ts');
    expect(payload).toContain('buildDriverOfferFcmMessage');
    expect(payload).toContain("'apns-push-type': 'alert'");
    expect(fcm).toContain('New ride request');
    expect(fcm).toContain('Open the app to review this ride request.');
    expect(service).toContain('buildDriverOfferFcmMessage');
    expect(service).toContain('DriverPush.booking_offer_send_start');
    expect(service).toContain('tokenSuffix');
  });

  it('registers driver_push_tokens migration in the journal', () => {
    const journal = JSON.parse(
      readSrc('src/db/migrations/meta/_journal.json')
    ) as { entries: { tag: string }[] };
    expect(journal.entries.some((e) => e.tag === '0024_driver_push_tokens')).toBe(true);
    expect(fs.existsSync(path.join(__dirname, '..', 'src/db/migrations/0024_driver_push_tokens.sql'))).toBe(
      true
    );
  });
});
