import { db } from '../db/connection';
import { customers, customerPlaces } from '../db/schema';
import { eq, and, desc, or, ilike, sql } from 'drizzle-orm';

const PLACE_TYPES = ['home', 'work', 'favorite', 'recent'] as const;
export type CustomerPlaceType = (typeof PLACE_TYPES)[number];

export async function findCustomerByAuth0Id(auth0Id: string) {
  const rows = await db.select().from(customers).where(eq(customers.auth0Id, auth0Id)).limit(1);
  return rows[0] ?? null;
}

export async function findCustomerByEmail(email: string) {
  const rows = await db.select().from(customers).where(eq(customers.email, email)).limit(1);
  return rows[0] ?? null;
}

export async function findCustomerById(id: string) {
  const rows = await db.select().from(customers).where(eq(customers.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function insertCustomer(data: typeof customers.$inferInsert) {
  const [row] = await db.insert(customers).values(data).returning();
  return row;
}

export async function updateCustomerSession(
  customerId: string,
  session: { activeSessionId: string; activeDeviceId?: string; activeDeviceInfo?: string }
) {
  const [row] = await db
    .update(customers)
    .set({
      activeSessionId: session.activeSessionId,
      activeDeviceId: session.activeDeviceId ?? null,
      activeDeviceInfo: session.activeDeviceInfo ?? null,
      lastLoginAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(customers.id, customerId))
    .returning();
  return row;
}

export async function clearCustomerSession(customerId: string) {
  await db
    .update(customers)
    .set({
      activeSessionId: null,
      activeDeviceId: null,
      activeDeviceInfo: null,
      updatedAt: new Date(),
    })
    .where(eq(customers.id, customerId));
}

export async function updateCustomerProfile(
  customerId: string,
  patch: {
    name?: string;
    phoneCountryCode?: string | null;
    phoneNumber?: string | null;
    profileImageUrl?: string | null;
    status?: string;
  }
) {
  const [row] = await db
    .update(customers)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(customers.id, customerId))
    .returning();
  return row ?? null;
}

export async function listCustomersForAdmin(params: {
  page: number;
  limit: number;
  search?: string;
}) {
  const { page, limit, search } = params;
  const offset = (page - 1) * limit;
  const pattern = search ? `%${search}%` : null;
  const where = pattern
    ? or(ilike(customers.name, pattern), ilike(customers.email, pattern))
    : undefined;

  const [totalRow] = where
    ? await db.select({ count: sql<number>`count(*)` }).from(customers).where(where)
    : await db.select({ count: sql<number>`count(*)` }).from(customers);

  const rows = where
    ? await db
        .select({
          id: customers.id,
          name: customers.name,
          email: customers.email,
          phoneCountryCode: customers.phoneCountryCode,
          phoneNumber: customers.phoneNumber,
          profileImageUrl: customers.profileImageUrl,
          status: customers.status,
          createdAt: customers.createdAt,
        })
        .from(customers)
        .where(where)
        .orderBy(desc(customers.createdAt))
        .limit(limit)
        .offset(offset)
    : await db
        .select({
          id: customers.id,
          name: customers.name,
          email: customers.email,
          phoneCountryCode: customers.phoneCountryCode,
          phoneNumber: customers.phoneNumber,
          profileImageUrl: customers.profileImageUrl,
          status: customers.status,
          createdAt: customers.createdAt,
        })
        .from(customers)
        .orderBy(desc(customers.createdAt))
        .limit(limit)
        .offset(offset);

  return { rows, total: Number(totalRow?.count ?? 0) };
}

export async function listCustomerPlaces(customerId: string, limit = 20) {
  return db
    .select()
    .from(customerPlaces)
    .where(eq(customerPlaces.customerId, customerId))
    .orderBy(desc(customerPlaces.lastUsedAt))
    .limit(limit);
}

export async function findCustomerPlaceById(customerId: string, placeId: string) {
  const rows = await db
    .select()
    .from(customerPlaces)
    .where(and(eq(customerPlaces.id, placeId), eq(customerPlaces.customerId, customerId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function upsertCustomerPlace(data: typeof customerPlaces.$inferInsert) {
  const placeType = (data.placeType ?? 'recent') as CustomerPlaceType;

  if (placeType === 'home' || placeType === 'work') {
    await db
      .delete(customerPlaces)
      .where(
        and(eq(customerPlaces.customerId, data.customerId), eq(customerPlaces.placeType, placeType))
      );
  }

  if (placeType === 'recent' && data.placeId) {
    await db
      .delete(customerPlaces)
      .where(
        and(
          eq(customerPlaces.customerId, data.customerId),
          eq(customerPlaces.placeType, 'recent'),
          eq(customerPlaces.placeId, data.placeId)
        )
      );
  }

  const [row] = await db.insert(customerPlaces).values(data).returning();
  return row;
}

export async function updateCustomerPlace(
  customerId: string,
  placeId: string,
  patch: Partial<typeof customerPlaces.$inferInsert>
) {
  const [row] = await db
    .update(customerPlaces)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(customerPlaces.id, placeId), eq(customerPlaces.customerId, customerId)))
    .returning();
  return row ?? null;
}

export async function deleteCustomerPlace(customerId: string, placeId: string) {
  const result = await db
    .delete(customerPlaces)
    .where(and(eq(customerPlaces.id, placeId), eq(customerPlaces.customerId, customerId)))
    .returning();
  return result[0] ?? null;
}

export async function listCustomerPlaceSuggestions(customerId: string, limit = 15) {
  const places = await listCustomerPlaces(customerId, 50);
  const pinned = places.filter((p) => ['home', 'work', 'favorite'].includes(p.placeType));
  const recent = places.filter((p) => p.placeType === 'recent');

  const seen = new Set<string>();
  const merged = [...pinned, ...recent].filter((p) => {
    const key = p.placeId ?? `${p.latitude},${p.longitude}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return merged.slice(0, limit);
}

export { PLACE_TYPES };
