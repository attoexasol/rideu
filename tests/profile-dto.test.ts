import {
  formatPhoneDisplay,
  toDriverProfileDto,
  toPassengerProfileDto,
} from '../src/services/profile.service';
import type { Driver } from '../src/db/schema/drivers';
import type { Customer } from '../src/db/schema/customers';

const driver = {
  id: 'drv-1',
  auth0Id: 'auth0|secret',
  email: 'driver@example.com',
  name: 'Driver One',
  phone: '+8801711111111',
  status: 'online',
  accountStatus: 'active',
  profileImageUrl: '/uploads/avatars/drivers/aaaa.jpg',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  activeSessionId: 'sess_secret',
  activeDeviceId: 'device-secret',
  qrCode: 'DRV_SECRET',
  vehicleQrCode: 'VQR_SECRET',
  cabLicence: 'LIC-SECRET',
} as unknown as Driver;

const customer = {
  id: 'cus-1',
  auth0Id: 'auth0|passenger',
  email: 'p@example.com',
  name: 'Passenger One',
  phoneCountryCode: '+880',
  phoneNumber: '1712345678',
  profileImageUrl: null,
  status: 'active',
  createdAt: new Date('2026-02-01T00:00:00.000Z'),
  activeSessionId: 'sess_p',
  activeDeviceId: 'dev_p',
} as unknown as Customer;

describe('profile DTOs', () => {
  it('driver DTO omits auth0/session/device/QR/cab fields', () => {
    const dto = toDriverProfileDto(driver, {
      id: 'veh-1',
      make: 'Toyota',
      model: 'Axio',
      plateNumber: 'DHA-1',
      color: 'White',
    });
    expect(dto).toEqual({
      id: 'drv-1',
      name: 'Driver One',
      email: 'driver@example.com',
      phone: '+8801711111111',
      profileImageUrl: '/uploads/avatars/drivers/aaaa.jpg',
      accountStatus: 'active',
      createdAt: driver.createdAt,
      vehicleSummary: {
        id: 'veh-1',
        make: 'Toyota',
        model: 'Axio',
        plateNumber: 'DHA-1',
        color: 'White',
      },
    });
    expect(JSON.stringify(dto)).not.toContain('auth0');
    expect(JSON.stringify(dto)).not.toContain('sess_secret');
    expect(JSON.stringify(dto)).not.toContain('device-secret');
    expect(JSON.stringify(dto)).not.toContain('DRV_SECRET');
    expect(JSON.stringify(dto)).not.toContain('LIC-SECRET');
  });

  it('passenger DTO omits auth0/session/device', () => {
    const dto = toPassengerProfileDto(customer);
    expect(dto).toEqual({
      id: 'cus-1',
      name: 'Passenger One',
      email: 'p@example.com',
      phone: '+8801712345678',
      profileImageUrl: null,
      accountStatus: 'active',
      createdAt: customer.createdAt,
    });
    expect(JSON.stringify(dto)).not.toContain('auth0');
    expect(JSON.stringify(dto)).not.toContain('sess_p');
  });

  it('formatPhoneDisplay returns e164', () => {
    expect(formatPhoneDisplay('+880', '1712345678')).toBe('+8801712345678');
    expect(formatPhoneDisplay(null, '1712345678')).toBeNull();
  });
});
