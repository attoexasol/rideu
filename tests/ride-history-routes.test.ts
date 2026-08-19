import fs from 'fs';
import path from 'path';

function readRoute(relPath: string) {
  return fs.readFileSync(path.join(__dirname, '..', relPath), 'utf8');
}

describe('ride history route registration', () => {
  it('registers driver collection GET before /:bookingId', () => {
    const src = readRoute('src/routes/v1/driver/bookings.ts');
    const collection = src.indexOf("router.get(\n  '/',");
    const active = src.indexOf("router.get('/active'");
    const detail = src.indexOf("'/:bookingId'");
    expect(collection).toBeGreaterThan(-1);
    expect(active).toBeGreaterThan(-1);
    expect(detail).toBeGreaterThan(-1);
    expect(collection).toBeLessThan(detail);
    expect(active).toBeLessThan(detail);
    expect(src).toContain('bookingHistoryQuerySchema');
    expect(src).toContain('listBookingsHandler');
  });

  it('keeps passenger /bookings history list before /bookings/:bookingId', () => {
    const src = readRoute('src/routes/v1/passenger/index.ts');
    const list = src.indexOf("'/bookings'");
    const active = src.indexOf("'/bookings/active'");
    const detail = src.indexOf("'/bookings/:bookingId'");
    expect(list).toBeGreaterThan(-1);
    expect(active).toBeGreaterThan(-1);
    expect(detail).toBeGreaterThan(-1);
    expect(list).toBeLessThan(detail);
    expect(active).toBeLessThan(detail);
    expect(src).toContain('bookingHistoryQuerySchema');
  });
});
