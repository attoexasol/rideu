import { eq, and } from 'drizzle-orm';
import { db } from '../db/connection';
import { rideMarkets, type RideMarket } from '../db/schema/ride_markets';
import {
  serviceCategoryMarketFares,
  type ServiceCategoryMarketFare,
  type NewServiceCategoryMarketFare,
} from '../db/schema/service_category_market_fares';

export async function listActiveRideMarkets(): Promise<RideMarket[]> {
  return db.select().from(rideMarkets).where(eq(rideMarkets.isActive, true)).orderBy(rideMarkets.code);
}

export async function listRideMarkets(): Promise<RideMarket[]> {
  return db.select().from(rideMarkets).orderBy(rideMarkets.code);
}

export async function findRideMarketByCountryCode(countryCode: string): Promise<RideMarket | null> {
  const rows = await db
    .select()
    .from(rideMarkets)
    .where(and(eq(rideMarkets.countryCode, countryCode), eq(rideMarkets.isActive, true)))
    .limit(1);
  return rows[0] ?? null;
}

export async function findRideMarketByCode(code: string): Promise<RideMarket | null> {
  const rows = await db.select().from(rideMarkets).where(eq(rideMarkets.code, code)).limit(1);
  return rows[0] ?? null;
}

export async function listMarketFares(marketId: string): Promise<ServiceCategoryMarketFare[]> {
  return db
    .select()
    .from(serviceCategoryMarketFares)
    .where(eq(serviceCategoryMarketFares.marketId, marketId));
}

export async function upsertMarketFare(
  values: NewServiceCategoryMarketFare
): Promise<ServiceCategoryMarketFare> {
  const existing = await db
    .select()
    .from(serviceCategoryMarketFares)
    .where(
      and(
        eq(serviceCategoryMarketFares.marketId, values.marketId),
        eq(serviceCategoryMarketFares.serviceCategoryId, values.serviceCategoryId)
      )
    )
    .limit(1);
  if (existing[0]) {
    const [updated] = await db
      .update(serviceCategoryMarketFares)
      .set({
        baseFare: values.baseFare,
        perKmRate: values.perKmRate,
        minFare: values.minFare,
        updatedAt: new Date(),
      })
      .where(eq(serviceCategoryMarketFares.id, existing[0].id))
      .returning();
    return updated;
  }
  const [created] = await db.insert(serviceCategoryMarketFares).values(values).returning();
  return created;
}
