import {
  boundsFromCoordinates,
  mapAutocompletePrediction,
  mapGeocodeResult,
  mapGoogleViewport,
  mapPlaceDetailsResult,
  maskPlateNumber,
  metersToKm,
  parseAddressComponents,
  parseDurationSeconds,
  secondsToMinutes,
} from '../src/services/googleMaps/googleMaps.mapper';

describe('googleMaps.mapper', () => {
  it('maps autocomplete prediction without coordinates', () => {
    const result = mapAutocompletePrediction({
      place_id: 'ChIJtest',
      description: 'Square Hospital, Dhaka',
      structured_formatting: {
        main_text: 'Square Hospital',
        secondary_text: 'Dhaka',
      },
      types: ['hospital'],
    });

    expect(result.placeId).toBe('ChIJtest');
    expect(result.label).toBe('Square Hospital');
    expect(result.latitude).toBeNull();
    expect(result.longitude).toBeNull();
  });

  it('parses Google duration strings', () => {
    expect(parseDurationSeconds('1440s')).toBe(1440);
    expect(secondsToMinutes(1440)).toBe(24);
    expect(metersToKm(7600)).toBe(7.6);
  });

  it('builds bounds from coordinates', () => {
    const bounds = boundsFromCoordinates([
      { latitude: 23.81, longitude: 90.41 },
      { latitude: 23.75, longitude: 90.38 },
    ]);
    expect(bounds.northeast.latitude).toBe(23.81);
    expect(bounds.southwest.latitude).toBe(23.75);
  });

  it('maps Google viewport', () => {
    const bounds = mapGoogleViewport({
      northeast: { lat: 24, lng: 91 },
      southwest: { lat: 23, lng: 90 },
    });
    expect(bounds?.northeast.latitude).toBe(24);
    expect(bounds?.southwest.longitude).toBe(90);
  });

  it('masks plate numbers', () => {
    expect(maskPlateNumber('DHK-1234')).toBe('DHK-****');
    expect(maskPlateNumber(null)).toBeNull();
  });

  it('uppercases countryCode from structured country components', () => {
    expect(
      parseAddressComponents([
        { long_name: 'Bangladesh', short_name: 'bd', types: ['country', 'political'] },
      ]).countryCode
    ).toBe('BD');
    expect(
      parseAddressComponents([
        { long_name: 'United States', short_name: 'us', types: ['country', 'political'] },
      ]).countryCode
    ).toBe('US');
  });

  it('maps reverse geocode and place details countryCode from components only', () => {
    const geo = mapGeocodeResult({
      place_id: 'ChIJ-geo',
      formatted_address: 'Dhaka, Bangladesh',
      geometry: { location: { lat: 23.81, lng: 90.41 } },
      address_components: [
        { long_name: 'Bangladesh', short_name: 'BD', types: ['country', 'political'] },
      ],
    });
    expect(geo.countryCode).toBe('BD');

    const details = mapPlaceDetailsResult({
      place_id: 'ChIJ-details',
      formatted_address: 'New York, NY, USA',
      geometry: { location: { lat: 40.758, lng: -73.9855 } },
      address_components: [
        { long_name: 'United States', short_name: 'US', types: ['country', 'political'] },
      ],
    });
    expect(details.countryCode).toBe('US');
    expect(details.country).toBe('United States');
  });
});
