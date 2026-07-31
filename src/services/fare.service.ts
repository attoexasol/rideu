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
  currency: string;
  promotion: {
    id: string;
    title: string;
    discountType: string;
    discountValue: number;
  } | null;
}

export interface QuoteResult {
  route: ReturnType<typeof toRouteSummary>;
  quotes: FareQuote[];
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

async function buildQuotesFromRoute(
  route: ComputedRoute,
  nearestDriverEtaByCategory?: Map<string, number>,
  filterCategoryId?: string
): Promise<FareQuote[]> {
  const categories = await listCanonicalActiveServiceCategories();
  const quotes: FareQuote[] = [];
  const seenIds = new Set<string>();

  for (const cat of categories) {
    if (cat.code === 'rental') continue;
    if (filterCategoryId && cat.id !== filterCategoryId) continue;
    if (seenIds.has(cat.id)) continue;
    seenIds.add(cat.id);

    const originalFare = calculateFareFromRates(
      parseDecimal(cat.baseFare),
      parseDecimal(cat.perKmRate),
      parseDecimal(cat.minFare),
      route.distanceKm
    );
    const promo = await findActivePromotion(cat.id);
    const applied = applyPromotion(originalFare, promo);
    const displayName = cleanServiceDisplayName(cat.name, cat.code);
    const publicCode = toPublicServiceCode(cat.code);

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
      finalFare: applied.finalFare,
      currency: 'BDT',
      promotion: applied.promotion,
    });
  }

  return quotes;
}

export async function quoteAllServiceCategories(
  pickup: LatLng & { address?: string },
  dropoff: LatLng & { address?: string },
  waypoints: (LatLng & { address?: string })[] = [],
  nearestDriverEtaByCategory?: Map<string, number>
): Promise<QuoteResult> {
  const route = await previewRoute({
    pickup: { ...pickup, address: pickup.address },
    dropoff: { ...dropoff, address: dropoff.address },
    stops: waypoints.map((w) => ({ ...w, address: w.address })),
  });

  const quotes = await buildQuotesFromRoute(route, nearestDriverEtaByCategory);
  return { route: toRouteSummary(route), quotes };
}

export async function quoteSingleCategory(
  serviceCategoryId: string,
  pickup: LatLng & { address?: string },
  dropoff: LatLng & { address?: string },
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

  const route = await previewRoute({
    pickup: { ...pickup, address: pickup.address },
    dropoff: { ...dropoff, address: dropoff.address },
    stops: waypoints.map((w) => ({ ...w, address: w.address })),
  });

  const quotes = await buildQuotesFromRoute(route, undefined, serviceCategoryId);
  if (!quotes.length) {
    throw new Error('Could not calculate fare');
  }

  const promo = await findActivePromotion(serviceCategoryId);
  return {
    route: toRouteSummary(route),
    quotes,
    promotionId: promo?.id ?? null,
  };
}
