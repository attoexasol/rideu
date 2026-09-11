/**
 * Pickup country → ride market → transaction currency.
 *
 * Country comes from Google Place Details / reverse geocode (existing APIs),
 * not from a home-grown lat/lng algorithm, airport code, phone, or device language.
 * A client country is used only when Google did not return a country, and
 * only if it matches an active market.
 */

import { normalizePlacesCountryCode } from './googleMaps/googleMaps.client';
import { fetchPlaceDetails, reverseGeocode } from './googleMaps/googleMaps.client';
import { logger } from '../middleware/logger';
import {
  findRideMarketByCode,
  findRideMarketByCountryCode,
  listMarketFares,
  listRideMarkets,
  upsertMarketFare,
} from '../repositories/rideMarket.repository';
import { listCanonicalActiveServiceCategories } from '../repositories/serviceCategory.repository';
import type { RideMarket } from '../db/schema/ride_markets';
import { MarketPricingNotConfiguredError, PaymentError, UnsupportedMarketError } from './payment.errors';
import { currenciesAreEqual, isSupportedTransactionCurrency, normalizeCurrencyCode } from '../constants/payment';

export { UnsupportedMarketError, MarketPricingNotConfiguredError };

export type CountrySource = 'place_id' | 'reverse_geocode' | 'client';

export interface ResolvedRideMarket {
  id: string;
  code: string;
  name: string;
  countryCode: string;
  currency: string;
  countrySource: CountrySource;
}

export async function resolvePickupCountryCode(input: {
  pickupLatitude: number;
  pickupLongitude: number;
  pickupPlaceId?: string | null;
  pickupCountryCode?: string | null;
}): Promise<{ countryCode: string | null; source: CountrySource | null }> {
  const clientCountry = normalizePlacesCountryCode(input.pickupCountryCode) ?? null;

  if (input.pickupPlaceId) {
    try {
      const details = await fetchPlaceDetails(input.pickupPlaceId);
      const fromPlace = normalizePlacesCountryCode(details.countryCode) ?? null;
      if (fromPlace) {
        return { countryCode: fromPlace, source: 'place_id' };
      }
    } catch (error) {
      logger.warn({
        type: 'ride_market.place_details_failed',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  try {
    const geo = await reverseGeocode(input.pickupLatitude, input.pickupLongitude);
    const fromGeo = normalizePlacesCountryCode(geo.countryCode) ?? null;
    if (fromGeo) {
      return { countryCode: fromGeo, source: 'reverse_geocode' };
    }
  } catch (error) {
    logger.warn({
      type: 'ride_market.reverse_geocode_failed',
      message: error instanceof Error ? error.message : String(error),
    });
  }

  if (clientCountry) {
    return { countryCode: clientCountry, source: 'client' };
  }
  return { countryCode: null, source: null };
}

export async function resolveRideMarket(input: {
  pickupLatitude: number;
  pickupLongitude: number;
  pickupPlaceId?: string | null;
  pickupCountryCode?: string | null;
}): Promise<ResolvedRideMarket> {
  const resolved = await resolvePickupCountryCode(input);
  if (!resolved.countryCode || !resolved.source) {
    throw new UnsupportedMarketError(
      'Pickup country could not be determined. Provide a Place ID or book inside a supported market.'
    );
  }

  const market = await findRideMarketByCountryCode(resolved.countryCode);
  if (!market) {
    logger.warn({
      type: 'ride_market.unsupported_country',
      countryCode: resolved.countryCode,
      countrySource: resolved.source,
    });
    throw new UnsupportedMarketError(
      `Pickup country ${resolved.countryCode} is not a supported ride market.`
    );
  }

  return {
    id: market.id,
    code: market.code,
    name: market.name,
    countryCode: market.countryCode,
    currency: normalizeCurrencyCode(market.currency),
    countrySource: resolved.source,
  };
}

export async function getMarketFareMap(marketId: string): Promise<
  Map<string, { baseFare: string; perKmRate: string; minFare: string }>
> {
  const rows = await listMarketFares(marketId);
  return new Map(
    rows.map((row) => [
      row.serviceCategoryId,
      { baseFare: row.baseFare, perKmRate: row.perKmRate, minFare: row.minFare },
    ])
  );
}

export async function assertMarketPricingConfigured(marketId: string): Promise<void> {
  const [fares, bookable] = await Promise.all([
    listMarketFares(marketId),
    listCanonicalActiveServiceCategories(),
  ]);
  const bookableIds = new Set(bookable.map((row) => row.id));
  const hasBookableFare = fares.some((row) => bookableIds.has(row.serviceCategoryId));
  if (!hasBookableFare) {
    throw new MarketPricingNotConfiguredError(
      'Fare pricing is not configured for this market. U.S. rates must be entered separately and are not copied from Bangladesh.'
    );
  }
}

export function formatRideMarket(row: RideMarket) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    countryCode: row.countryCode,
    currency: row.currency,
    isActive: row.isActive,
  };
}

export async function listMarketsForAdmin() {
  return (await listRideMarkets()).map(formatRideMarket);
}

/**
 * Admin market-fare editor lists currently bookable categories only
 * (`is_active` + exact canonical codes). Historical/orphan category fare
 * rows stay in the table for audit but are not returned for configuration.
 */
export async function getMarketFaresForAdmin(code: string) {
  const market = await findRideMarketByCode(code.toUpperCase());
  if (!market) {
    throw new PaymentError('MARKET_NOT_FOUND', 'Ride market not found', 404);
  }
  const [bookable, stored] = await Promise.all([
    listCanonicalActiveServiceCategories(),
    listMarketFares(market.id),
  ]);
  const byCategoryId = new Map(stored.map((row) => [row.serviceCategoryId, row]));
  return {
    market: formatRideMarket(market),
    fares: bookable.map((category) => {
      const row = byCategoryId.get(category.id);
      return {
        serviceCategoryId: category.id,
        code: category.code,
        name: category.name,
        baseFare: row?.baseFare ?? null,
        perKmRate: row?.perKmRate ?? null,
        minFare: row?.minFare ?? null,
      };
    }),
  };
}

export async function upsertMarketFaresForAdmin(
  code: string,
  fares: Array<{
    serviceCategoryId: string;
    baseFare: string | number;
    perKmRate: string | number;
    minFare: string | number;
  }>
) {
  const market = await findRideMarketByCode(code.toUpperCase());
  if (!market) {
    throw new PaymentError('MARKET_NOT_FOUND', 'Ride market not found', 404);
  }
  const bookable = await listCanonicalActiveServiceCategories();
  const bookableIds = new Set(bookable.map((row) => row.id));
  const rejected = fares.filter((fare) => !bookableIds.has(fare.serviceCategoryId));
  if (rejected.length) {
    throw new PaymentError(
      'SERVICE_CATEGORY_NOT_BOOKABLE',
      'Market fares can only be configured for currently bookable service categories.',
      400
    );
  }
  for (const fare of fares) {
    await upsertMarketFare({
      marketId: market.id,
      serviceCategoryId: fare.serviceCategoryId,
      baseFare: typeof fare.baseFare === 'number' ? fare.baseFare.toFixed(2) : fare.baseFare,
      perKmRate: typeof fare.perKmRate === 'number' ? fare.perKmRate.toFixed(2) : fare.perKmRate,
      minFare: typeof fare.minFare === 'number' ? fare.minFare.toFixed(2) : fare.minFare,
    });
  }
  return getMarketFaresForAdmin(market.code);
}

export async function assertAirportCompatibleWithMarket(input: {
  countryCode: string;
  currency: string;
  isActive: boolean;
}) {
  if (!input.isActive) return;
  if (!isSupportedTransactionCurrency(input.currency)) {
    throw new PaymentError(
      'UNSUPPORTED_AIRPORT_CURRENCY',
      `Airport currency ${normalizeCurrencyCode(input.currency)} is not a supported booking currency.`,
      400
    );
  }
  const market = await findRideMarketByCountryCode(input.countryCode.toUpperCase());
  if (market && !currenciesAreEqual(market.currency, input.currency)) {
    throw new PaymentError(
      'AIRPORT_MARKET_CURRENCY_MISMATCH',
      `Airport currency ${normalizeCurrencyCode(input.currency)} does not match the ${market.code} market currency ${market.currency}.`,
      400
    );
  }
}
