import axios from 'axios';
import {
  autocompletePlaces,
  buildAutocompleteProviderParams,
  computeRoute,
  normalizePlacesCountryCode,
} from '../src/services/googleMaps/googleMaps.client';
import {
  mapGeocodeResult,
  mapPlaceDetailsResult,
  parseAddressComponents,
} from '../src/services/googleMaps/googleMaps.mapper';
import { placesAutocompleteQuerySchema, routePreviewSchema } from '../src/validators';

jest.mock('axios');
jest.mock('../src/config/redis', () => ({
  mapsCache: {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
  },
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;

const BD_COMPONENTS = [
  { long_name: 'Dhaka', short_name: 'Dhaka', types: ['locality', 'political'] },
  { long_name: 'Dhaka District', short_name: 'Dhaka District', types: ['administrative_area_level_2'] },
  { long_name: 'Bangladesh', short_name: 'bd', types: ['country', 'political'] },
];

const US_COMPONENTS = [
  { long_name: 'New York', short_name: 'New York', types: ['locality', 'political'] },
  { long_name: 'New York', short_name: 'NY', types: ['administrative_area_level_1'] },
  { long_name: 'United States', short_name: 'us', types: ['country', 'political'] },
];

function lastAutocompleteParams(): Record<string, string> {
  const call = mockedAxios.get.mock.calls[mockedAxios.get.mock.calls.length - 1];
  return (call[1] as { params: Record<string, string> }).params;
}

describe('passenger places country handling', () => {
  beforeEach(() => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    process.env.GOOGLE_MAPS_DEFAULT_COUNTRY = 'BD';
    process.env.GOOGLE_MAPS_REGION = 'BD';
    process.env.GOOGLE_MAPS_LANGUAGE = 'en';
    jest.clearAllMocks();
  });

  describe('A/B provider restriction', () => {
    it('maps country=BD to components=country:BD', () => {
      const params = buildAutocompleteProviderParams('Mirpur', {
        lat: 23.75,
        lng: 90.38,
        country: 'BD',
      });
      expect(params.components).toBe('country:BD');
      expect(params.components).not.toContain('US');
    });

    it('maps country=US to components=country:US', () => {
      const params = buildAutocompleteProviderParams('Broadway', {
        lat: 40.758,
        lng: -73.9855,
        country: 'US',
      });
      expect(params.components).toBe('country:US');
      expect(params.components).not.toContain('BD');
    });
  });

  describe('C/D country normalization', () => {
    it('normalizes lowercase bd to BD', () => {
      expect(normalizePlacesCountryCode('bd')).toBe('BD');
      expect(placesAutocompleteQuerySchema.parse({ input: 'Mirpur', country: 'bd' }).country).toBe(
        'BD'
      );
      expect(buildAutocompleteProviderParams('Mirpur', { country: 'bd' }).components).toBe(
        'country:BD'
      );
    });

    it('normalizes lowercase us to US', () => {
      expect(normalizePlacesCountryCode('us')).toBe('US');
      expect(placesAutocompleteQuerySchema.parse({ input: 'Broadway', country: 'us' }).country).toBe(
        'US'
      );
      expect(buildAutocompleteProviderParams('Broadway', { country: 'us' }).components).toBe(
        'country:US'
      );
    });
  });

  describe('E invalid country', () => {
    it('rejects invalid country at the API validator', () => {
      expect(placesAutocompleteQuerySchema.safeParse({ input: 'Mirpur', country: 'USA' }).success).toBe(
        false
      );
      expect(placesAutocompleteQuerySchema.safeParse({ input: 'Mirpur', country: '12' }).success).toBe(
        false
      );
      expect(placesAutocompleteQuerySchema.safeParse({ input: 'Mirpur', country: 'U' }).success).toBe(
        false
      );
      expect(placesAutocompleteQuerySchema.safeParse({ input: 'Mirpur', country: 'B1' }).success).toBe(
        false
      );
    });

    it('does not guess a country when an invalid code reaches the provider builder', () => {
      expect(normalizePlacesCountryCode('USA')).toBeUndefined();
      expect(normalizePlacesCountryCode('12')).toBeUndefined();
      const params = buildAutocompleteProviderParams('Mirpur', { country: 'USA' });
      expect(params.components).toBeUndefined();
    });
  });

  describe('F omitted country remains unrestricted', () => {
    it('does not apply GOOGLE_MAPS_DEFAULT_COUNTRY when country is omitted', () => {
      const params = buildAutocompleteProviderParams('Mirpur', { lat: 23.75, lng: 90.38 });
      expect(params.components).toBeUndefined();
      expect(params.input).toBe('Mirpur');
    });
  });

  describe('G/H reverse geocode countryCode', () => {
    it('returns countryCode=BD from Bangladesh address components', () => {
      const mapped = mapGeocodeResult({
        place_id: 'ChIJ-bd',
        formatted_address: 'Mirpur, Dhaka, Bangladesh',
        geometry: { location: { lat: 23.81, lng: 90.41 } },
        address_components: BD_COMPONENTS,
        types: ['locality'],
      });
      expect(mapped.country).toBe('Bangladesh');
      expect(mapped.countryCode).toBe('BD');
    });

    it('returns countryCode=US from United States address components', () => {
      const mapped = mapGeocodeResult({
        place_id: 'ChIJ-us',
        formatted_address: 'Broadway, New York, NY, USA',
        geometry: { location: { lat: 40.758, lng: -73.9855 } },
        address_components: US_COMPONENTS,
        types: ['route'],
      });
      expect(mapped.country).toBe('United States');
      expect(mapped.countryCode).toBe('US');
    });
  });

  describe('I place details preserves countryCode', () => {
    it('preserves and uppercases countryCode from provider components', () => {
      const bd = mapPlaceDetailsResult({
        place_id: 'ChIJ-details-bd',
        name: 'Square Hospital',
        formatted_address: '18 Bir Uttam Qazi Rd, Dhaka, Bangladesh',
        geometry: { location: { lat: 23.81, lng: 90.41 } },
        address_components: BD_COMPONENTS,
      });
      expect(bd.country).toBe('Bangladesh');
      expect(bd.countryCode).toBe('BD');

      const us = mapPlaceDetailsResult({
        place_id: 'ChIJ-details-us',
        name: 'Times Square',
        formatted_address: 'Times Square, New York, NY, USA',
        geometry: { location: { lat: 40.758, lng: -73.9855 } },
        address_components: US_COMPONENTS,
      });
      expect(us.country).toBe('United States');
      expect(us.countryCode).toBe('US');
    });

    it('does not invent countryCode from formatted address text', () => {
      const parsed = parseAddressComponents([]);
      expect(parsed.country).toBeNull();
      expect(parsed.countryCode).toBeNull();

      const mapped = mapPlaceDetailsResult({
        place_id: 'ChIJ-no-components',
        name: 'Unknown',
        formatted_address: 'Somewhere, Bangladesh',
        geometry: { location: { lat: 23.81, lng: 90.41 } },
        address_components: [],
      });
      expect(mapped.countryCode).toBeNull();
    });
  });

  describe('J/K no hardcoded country override', () => {
    it('does not force US when country=BD even if default country env is US', () => {
      process.env.GOOGLE_MAPS_DEFAULT_COUNTRY = 'US';
      const params = buildAutocompleteProviderParams('Mirpur', { country: 'BD' });
      expect(params.components).toBe('country:BD');
    });

    it('does not force BD when country=US even if default country env is BD', () => {
      process.env.GOOGLE_MAPS_DEFAULT_COUNTRY = 'BD';
      const params = buildAutocompleteProviderParams('Broadway', { country: 'US' });
      expect(params.components).toBe('country:US');
    });

    it('does not inject US or BD when country is omitted', () => {
      process.env.GOOGLE_MAPS_DEFAULT_COUNTRY = 'BD';
      const params = buildAutocompleteProviderParams('Broadway');
      expect(params.components).toBeUndefined();
    });
  });

  describe('L lat/lng bias remains intact', () => {
    it('keeps dynamic Dhaka bias with country=BD', () => {
      const params = buildAutocompleteProviderParams('Mirpur', {
        lat: 23.75,
        lng: 90.38,
        country: 'BD',
      });
      expect(params.location).toBe('23.75,90.38');
      expect(params.radius).toBe('50000');
      expect(params.components).toBe('country:BD');
    });

    it('keeps dynamic New York bias with country=US', () => {
      const params = buildAutocompleteProviderParams('Broadway', {
        lat: 40.758,
        lng: -73.9855,
        country: 'US',
      });
      expect(params.location).toBe('40.758,-73.9855');
      expect(params.radius).toBe('50000');
      expect(params.components).toBe('country:US');
    });
  });

  describe('provider request wiring', () => {
    it('forwards built params on the legacy Places Autocomplete request', async () => {
      mockedAxios.get.mockResolvedValue({ data: { status: 'ZERO_RESULTS', predictions: [] } });

      await autocompletePlaces('Mirpur', { lat: 23.75, lng: 90.38, country: 'us' });

      expect(mockedAxios.get).toHaveBeenCalledWith(
        'https://maps.googleapis.com/maps/api/place/autocomplete/json',
        expect.objectContaining({
          params: expect.objectContaining({
            input: 'Mirpur',
            components: 'country:US',
            location: '23.75,90.38',
            radius: '50000',
            key: 'test-key',
          }),
        })
      );
      const params = lastAutocompleteParams();
      expect(params.components).not.toBe('country:BD');
    });

    it('omits components on the provider request when country is omitted', async () => {
      mockedAxios.get.mockResolvedValue({ data: { status: 'ZERO_RESULTS', predictions: [] } });

      await autocompletePlaces('Broadway', { lat: 40.758, lng: -73.9855 });

      const params = lastAutocompleteParams();
      expect(params.components).toBeUndefined();
      expect(params.location).toBe('40.758,-73.9855');
    });
  });

  describe('M route preview has no hidden single-country restriction', () => {
    it('accepts US coordinates without a country gate', () => {
      const parsed = routePreviewSchema.safeParse({
        pickup: { latitude: 40.758, longitude: -73.9855, address: 'Times Square' },
        dropoff: { latitude: 40.7484, longitude: -73.9857, address: 'Herald Square' },
      });
      expect(parsed.success).toBe(true);
    });

    it('accepts Bangladesh coordinates without a country gate', () => {
      const parsed = routePreviewSchema.safeParse({
        pickup: { latitude: 23.8103, longitude: 90.4125 },
        dropoff: { latitude: 23.7527, longitude: 90.3818 },
      });
      expect(parsed.success).toBe(true);
    });

    it('sends US waypoints to Routes API without a country validation field', async () => {
      mockedAxios.post.mockResolvedValue({
        data: {
          routes: [
            {
              duration: '600s',
              staticDuration: '480s',
              distanceMeters: 1200,
              polyline: { encodedPolyline: 'us_polyline' },
              viewport: {
                northeast: { latitude: 40.76, longitude: -73.98 },
                southwest: { latitude: 40.74, longitude: -73.99 },
              },
              legs: [
                {
                  duration: '600s',
                  distanceMeters: 1200,
                  startLocation: { latLng: { latitude: 40.758, longitude: -73.9855 } },
                  endLocation: { latLng: { latitude: 40.7484, longitude: -73.9857 } },
                },
              ],
            },
          ],
        },
      });

      const route = await computeRoute({
        pickup: { latitude: 40.758, longitude: -73.9855, address: 'Times Square' },
        dropoff: { latitude: 40.7484, longitude: -73.9857, address: 'Herald Square' },
      });

      expect(route.encodedPolyline).toBe('us_polyline');
      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://routes.googleapis.com/directions/v2:computeRoutes',
        expect.objectContaining({
          origin: {
            location: { latLng: { latitude: 40.758, longitude: -73.9855 } },
          },
          destination: {
            location: { latLng: { latitude: 40.7484, longitude: -73.9857 } },
          },
        }),
        expect.any(Object)
      );
      const body = mockedAxios.post.mock.calls[0][1] as Record<string, unknown>;
      expect(body).not.toHaveProperty('country');
      expect((body.origin as { country?: unknown }).country).toBeUndefined();
    });
  });
});
