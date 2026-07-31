import { bookingQuoteSchema, reverseGeocodeQuerySchema, placesAutocompleteQuerySchema } from '../src/validators';

describe('passenger validators', () => {
  it('rejects latitude out of range', () => {
    const result = reverseGeocodeQuerySchema.safeParse({ lat: '95', lng: '90.4' });
    expect(result.success).toBe(false);
  });

  it('accepts valid reverse geocode query', () => {
    const result = reverseGeocodeQuerySchema.safeParse({ lat: '23.8103', lng: '90.4125' });
    expect(result.success).toBe(true);
  });

  it('rejects autocomplete input that is too short', () => {
    const result = placesAutocompleteQuerySchema.safeParse({ input: 'a' });
    expect(result.success).toBe(false);
  });

  it('validates booking quote coordinates', () => {
    const result = bookingQuoteSchema.safeParse({
      pickup: { latitude: 23.81, longitude: 90.41 },
      dropoff: { latitude: 23.75, longitude: 90.38 },
    });
    expect(result.success).toBe(true);
  });
});
