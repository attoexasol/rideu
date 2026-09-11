import {
  findServiceCategoryById,
  findActivePromotion,
  listCanonicalActiveServiceCategories,
} from '../repositories/serviceCategory.repository';
import { previewRoute, toRouteSummary } from './route.service';
import { LatLng } from './googleMaps/types';
import { ComputedRoute } from './googleMaps/types';
import {
  cleanServiceDisplayName,
  toPublicServiceCode,
  isCanonicalExactCode,
  normalizeServiceCategoryBase,
} from '../utils/serviceCategoryNormalize';
import { isAirportFeeChargeable } from '../constants/payment';
import {
  airportPublicView,
  detectAirportTrip,
  EMPTY_AIRPORT_DETECTION,
  type AirportTripDetection,
} from './airportDetection.service';
import {
  assertMarketPricingConfigured,
  getMarketFareMap,
  resolveRideMarket,
  type ResolvedRideMarket,
} from './rideMarket.service';
import { minorToMajorString } from '../utils/money';

export interface FareQuote {
  serviceCategoryId: string;
  serviceCode: string;
  serviceName: string;
  /** Customer-facing label without UUID fragments */
  displayName: string;
  code: string;
  description: string | null;
  iconKey: string | null;
  capacity: number;
  distanceKm: number;
  durationMin: number;
  driverEtaMinutes: number | null;
  originalFare: number;
  discountType: string | null;
  discountValue: number | null;
  discountAmount: number;
  finalFare: number;
  regularFare: number;
  airportFee: number;
  airport: {
    id: string;
    code: string;
    name: string;
    tripType: 'pickup' | 'dropoff';
  } | null;
  currency: string;
  marketCode: string;
  pickupCountryCode: string;
  promotion: {
    id: string;
    title: string;
    discountType: string;
    discountValue: number;
  } | null;
}

export interface QuoteLocation extends LatLng {
  address?: string;
  placeId?: string | null;
  countryCode?: string | null;
}

export interface QuoteResult {
  route: ReturnType<typeof toRouteSummary>;
  quotes: FareQuote[];
  market: {
    code: string;
    countryCode: string;
    currency: string;
  };
}

function parseDecimal(value: string | null | undefined): number {
  return value ? parseFloat(value) : 0;
}

function calculateFareFromRates(
  baseFare: number,
  perKmRate: number,
  minFare: number,
  distanceKm: number
): number {
  const raw = baseFare + perKmRate * distanceKm;
  return Math.max(minFare, Math.round(raw * 100) / 100);
}

function applyPromotion(
  originalFare: number,
  promotion: {
    id: string;
    discountType: string;
    discountValue: string;
    title: string;
  } | null
): {
  discountAmount: number;
  finalFare: number;
  discountType: string | null;
  discountValue: number | null;
  promotion: FareQuote['promotion'];
} {
  if (!promotion) {
    return {
      discountAmount: 0,
      finalFare: originalFare,
      discountType: null,
      discountValue: null,
      promotion: null,
    };
  }
  const value = parseFloat(promotion.discountValue);
  let discount = 0;
  if (promotion.discountType === 'percent') {
    discount = Math.round(originalFare * (value / 100) * 100) / 100;
  } else {
    discount = value;
  }
  const finalFare = Math.max(0, Math.round((originalFare - discount) * 100) / 100);
  return {
    discountAmount: discount,
    finalFare,
    discountType: promotion.discountType,
    discountValue: value,
    promotion: {
      id: promotion.id,
      title: promotion.title,
      discountType: promotion.discountType,
      discountValue: value,
    },
  };
}

async function detectAirportForRoute(
  pickup: QuoteLocation,
  dropoff: QuoteLocation,
  transactionCurrency: string
): Promise<AirportTripDetection> {
  return detectAirportTrip({
    pickupLatitude: pickup.latitude,
    pickupLongitude: pickup.longitude,
    pickupPlaceId: pickup.placeId,
    dropoffLatitude: dropoff.latitude,
    dropoffLongitude: dropoff.longitude,
    dropoffPlaceId: dropoff.placeId,
    transactionCurrency,
  });
}

function applyAirportFeeToRegularFare(
  regularFare: number,
  detection: AirportTripDetection,
  transactionCurrency: string
): { regularFare: number; airportFee: number; finalFare: number } {
  const chargeable =
    detection.feeMinor > 0 &&
    !detection.currencyMismatch &&
    isAirportFeeChargeable(detection.currency, transactionCurrency);
  const airportFee = chargeable ? parseFloat(minorToMajorString(detection.feeMinor)) : 0;
  const finalFare = Math.round((regularFare + airportFee) * 100) / 100;
  return { regularFare, airportFee, finalFare };
}

async function buildQuotesFromRoute(
  route: ComputedRoute,
  market: ResolvedRideMarket,
  marketFares: Map<string, { baseFare: string; perKmRate: string; minFare: string }>,
  nearestDriverEtaByCategory?: Map<string, number>,
  filterCategoryId?: string,
  airportDetection?: AirportTripDetection
): Promise<FareQuote[]> {
  const categories = await listCanonicalActiveServiceCategories();
  const quotes: FareQuote[] = [];
  const seenIds = new Set<string>();

  for (const cat of categories) {
    if (cat.code === 'rental') continue;
    if (filterCategoryId && cat.id !== filterCategoryId) continue;
    if (seenIds.has(cat.id)) continue;
    seenIds.add(cat.id);

    const rates = marketFares.get(cat.id);
    if (!rates) continue;

    const originalFare = calculateFareFromRates(
      parseDecimal(rates.baseFare),
      parseDecimal(rates.perKmRate),
      parseDecimal(rates.minFare),
      route.distanceKm
    );
    const promo = await findActivePromotion(cat.id);
    const applied = applyPromotion(originalFare, promo);
    const displayName = cleanServiceDisplayName(cat.name, cat.code);
    const publicCode = toPublicServiceCode(cat.code);
    const withAirport = applyAirportFeeToRegularFare(
      applied.finalFare,
      airportDetection ?? EMPTY_AIRPORT_DETECTION,
      market.currency
    );

    quotes.push({
      serviceCategoryId: cat.id,
      serviceCode: publicCode,
      serviceName: displayName,
      displayName,
      code: publicCode,
      description: cat.description,
      iconKey: cat.iconKey,
      capacity: cat.capacity,
      distanceKm: route.distanceKm,
      durationMin: route.durationMin,
      driverEtaMinutes: nearestDriverEtaByCategory?.get(cat.id) ?? null,
      originalFare,
      discountType: applied.discountType,
      discountValue: applied.discountValue,
      discountAmount: applied.discountAmount,
      regularFare: withAirport.regularFare,
      airportFee: withAirport.airportFee,
      finalFare: withAirport.finalFare,
      airport: airportDetection ? airportPublicView(airportDetection) : null,
      currency: market.currency,
      marketCode: market.code,
      pickupCountryCode: market.countryCode,
      promotion: applied.promotion,
    });
  }

  return quotes;
}

async function resolveQuoteContext(
  pickup: QuoteLocation,
  dropoff: QuoteLocation,
  waypoints: (LatLng & { address?: string })[]
) {
  const market = await resolveRideMarket({
    pickupLatitude: pickup.latitude,
    pickupLongitude: pickup.longitude,
    pickupPlaceId: pickup.placeId,
    pickupCountryCode: pickup.countryCode,
  });
  await assertMarketPricingConfigured(market.id);
  const [route, airportDetection, marketFares] = await Promise.all([
    previewRoute({
      pickup: { latitude: pickup.latitude, longitude: pickup.longitude, address: pickup.address },
      dropoff: { latitude: dropoff.latitude, longitude: dropoff.longitude, address: dropoff.address },
      stops: waypoints.map((w) => ({ latitude: w.latitude, longitude: w.longitude, address: w.address })),
    }),
    detectAirportForRoute(pickup, dropoff, market.currency),
    getMarketFareMap(market.id),
  ]);
  return { market, route, airportDetection, marketFares };
}

export async function quoteAllServiceCategories(
  pickup: QuoteLocation,
  dropoff: QuoteLocation,
  waypoints: (LatLng & { address?: string })[] = [],
  nearestDriverEtaByCategory?: Map<string, number>
): Promise<QuoteResult> {
  const { market, route, airportDetection, marketFares } = await resolveQuoteContext(
    pickup,
    dropoff,
    waypoints
  );
  const quotes = await buildQuotesFromRoute(
    route,
    market,
    marketFares,
    nearestDriverEtaByCategory,
    undefined,
    airportDetection
  );
  return {
    route: toRouteSummary(route),
    quotes,
    market: { code: market.code, countryCode: market.countryCode, currency: market.currency },
  };
}

export async function quoteSingleCategory(
  serviceCategoryId: string,
  pickup: QuoteLocation,
  dropoff: QuoteLocation,
  waypoints: (LatLng & { address?: string })[] = []
): Promise<QuoteResult & { promotionId: string | null }> {
  let cat = await findServiceCategoryById(serviceCategoryId);
  if (!cat || !cat.isActive) {
    throw new Error('Service category not found or inactive');
  }

  // Redirect orphan/suffixed IDs to the canonical product row when still active
  if (!isCanonicalExactCode(cat.code)) {
    const base = normalizeServiceCategoryBase(cat.code) ?? normalizeServiceCategoryBase(cat.name);
    if (base) {
      const { findServiceCategoryByCode } = await import(
        '../repositories/serviceCategory.repository'
      );
      const canonical = await findServiceCategoryByCode(base);
      if (canonical?.isActive) {
        cat = canonical;
        serviceCategoryId = canonical.id;
      } else {
        throw new Error('Service category not found or inactive');
      }
    }
  }

  const { market, route, airportDetection, marketFares } = await resolveQuoteContext(
    pickup,
    dropoff,
    waypoints
  );
  const quotes = await buildQuotesFromRoute(
    route,
    market,
    marketFares,
    undefined,
    serviceCategoryId,
    airportDetection
  );
  if (!quotes.length) {
    throw new Error('Could not calculate fare');
  }

  const promo = await findActivePromotion(serviceCategoryId);
  return {
    route: toRouteSummary(route),
    quotes,
    market: { code: market.code, countryCode: market.countryCode, currency: market.currency },
    promotionId: promo?.id ?? null,
  };
}
