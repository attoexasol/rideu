import { fetchPlaceDetails, reverseGeocode } from '../src/services/googleMaps/googleMaps.client';
import { listServiceAreasForMarket } from '../src/repositories/serviceArea.repository';
import {
  assertNearbyQueryPermitted,
  assertResolvedRidePermitted,
  clearServiceAreaCache,
} from '../src/services/serviceArea.service';
import { OutOfServiceAreaError } from '../src/services/payment.errors';

jest.mock('../src/services/googleMaps/googleMaps.client', () => ({
  normalizePlacesCountryCode: (value: unknown) => {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    if (!/^[A-Za-z]{2}$/.test(trimmed)) return undefined;
    return trimmed.toUpperCase();
  },
  fetchPlaceDetails: jest.fn(),
  reverseGeocode: jest.fn(),
}));

jest.mock('../src/repositories/rideMarket.repository', () => ({
  findRideMarketByCountryCode: jest.fn(async (countryCode: string) => ({
    id: `market-${countryCode}`,
    code: countryCode,
    name: countryCode,
    countryCode,
    currency: countryCode === 'US' ? 'USD' : 'BDT',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  })),
}));

jest.mock('../src/repositories/serviceArea.repository', () => ({
  listServiceAreasForMarket: jest.fn(),
  findServiceAreaById: jest.fn(),
  nextServiceAreaVersion: jest.fn(),
  insertServiceArea: jest.fn(),
  activateServiceAreaRecord: jest.fn(),
}));

const zone = {
  type: 'Polygon' as const,
  coordinates: [
    [
      [0, 0],
      [2, 0],
      [2, 2],
      [0, 2],
      [0, 0],
    ],
  ],
};

const inside = { latitude: 1, longitude: 1 };
const outside = { latitude: 4, longitude: 4 };

describe('authoritative market resolution', () => {
  beforeEach(() => {
    clearServiceAreaCache();
    (listServiceAreasForMarket as jest.Mock).mockResolvedValue([
      {
        id: 'area-1',
        marketCode: 'US',
        code: 'coronado',
        name: 'Coronado',
        version: 1,
        status: 'active',
        geometry: zone,
        policy: 'pickup_and_dropoff',
        enforcementEnabled: true,
        sourceLabel: null,
        sourceUrl: null,
        approvedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    (fetchPlaceDetails as jest.Mock).mockReset();
    (reverseGeocode as jest.Mock).mockReset();
  });

  it('uses the Google pickup country when the client claims Bangladesh', async () => {
    (fetchPlaceDetails as jest.Mock).mockResolvedValue({ countryCode: 'US' });
    (reverseGeocode as jest.Mock).mockResolvedValue({ countryCode: 'BD' });

    await expect(
      assertResolvedRidePermitted({
        pickup: { ...outside, placeId: 'place-us', countryCode: 'BD' },
        dropoff: inside,
      })
    ).rejects.toBeInstanceOf(OutOfServiceAreaError);
    expect(reverseGeocode).not.toHaveBeenCalled();
  });

  it('does not let a client US hint fence a Bangladesh pickup', async () => {
    (fetchPlaceDetails as jest.Mock).mockResolvedValue({ countryCode: 'BD' });
    (listServiceAreasForMarket as jest.Mock).mockClear();
    await expect(
      assertResolvedRidePermitted({
        pickup: { ...outside, placeId: 'place-bd', countryCode: 'US' },
        dropoff: outside,
        stops: [outside],
      })
    ).resolves.toMatchObject({ code: 'BD' });
    expect(listServiceAreasForMarket).not.toHaveBeenCalled();
  });

  it('applies the US polygon to route preview and the BD polygon to neither end', async () => {
    (fetchPlaceDetails as jest.Mock).mockResolvedValue({ countryCode: 'US' });
    await expect(
      assertResolvedRidePermitted({
        pickup: { ...inside, placeId: 'place-us' },
        dropoff: outside,
      })
    ).rejects.toMatchObject({ details: { failedPoints: ['dropoff'] } });

    (fetchPlaceDetails as jest.Mock).mockResolvedValue({ countryCode: 'BD' });
    await expect(
      assertResolvedRidePermitted({
        pickup: { ...outside, placeId: 'place-bd' },
        dropoff: outside,
      })
    ).resolves.toMatchObject({ code: 'BD' });
  });

  it('resolves nearby drivers from the pin instead of a client country', async () => {
    (reverseGeocode as jest.Mock).mockResolvedValue({ countryCode: 'US' });
    await expect(assertNearbyQueryPermitted(outside.latitude, outside.longitude)).rejects.toMatchObject({
      code: 'OUT_OF_SERVICE_AREA',
    });

    clearServiceAreaCache();
    (reverseGeocode as jest.Mock).mockResolvedValue({ countryCode: 'BD' });
    await expect(
      assertNearbyQueryPermitted(outside.latitude, outside.longitude)
    ).resolves.toMatchObject({ code: 'BD' });
  });
});
