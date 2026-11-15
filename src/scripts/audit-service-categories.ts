/**
 * Report-only audit of service_categories and duplicates.
 * Does not mutate data.
 *
 * Usage: npx tsx src/scripts/audit-service-categories.ts
 */
import 'dotenv/config';
import postgres from 'postgres';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const CANONICAL_BASES = [
  'economy',
  'executive',
  'suv',
  'van',
  'minivan',
  'ada',
  'ride',
  'bike',
  'cng',
  'moto',
  'premium',
  'comfort',
] as const;

function normalizeBase(codeOrName: string): string | null {
  const raw = codeOrName.trim().toLowerCase();
  const stripped = raw
    .replace(/[_-]?[0-9a-f]{6,}$/i, '')
    .replace(/^[a-z]+[-_]/, (m) => m.replace(/[-_]/g, ''))
    .replace(/\s+[0-9a-f-]{6,}$/i, '')
    .trim();

  for (const base of CANONICAL_BASES) {
    if (
      raw === base ||
      raw.startsWith(`${base}-`) ||
      raw.startsWith(`${base}_`) ||
      stripped === base ||
      raw.startsWith(`${base} `) ||
      stripped.startsWith(base)
    ) {
      // Prefer exact family match for known product names
      if (raw === base || raw.startsWith(`${base}-`) || raw.startsWith(`${base} `)) return base;
    }
  }

  // Name like "Bike f1eadf32"
  for (const base of CANONICAL_BASES) {
    const re = new RegExp(`^${base}([\\s_-]|$)`, 'i');
    if (re.test(raw)) return base;
  }

  return null;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL required');
    process.exit(1);
  }

  const sql = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 15 });

  try {
    const categories = await sql`
      SELECT
        sc.id,
        sc.code,
        sc.name,
        sc.description,
        sc.icon_key,
        sc.capacity,
        sc.base_fare,
        sc.per_km_rate,
        sc.min_fare,
        sc.is_active,
        sc.sort_order,
        sc.created_at,
        sc.updated_at,
        (SELECT count(*)::int FROM driver_service_categories d
          WHERE d.service_category_id = sc.id) AS linked_drivers,
        (SELECT count(*)::int FROM vehicle_service_categories v
          WHERE v.service_category_id = sc.id) AS linked_vehicles,
        (SELECT count(*)::int FROM bookings b
          WHERE b.service_category_id = sc.id) AS linked_bookings,
        (SELECT count(*)::int FROM promotions p
          WHERE p.service_category_id = sc.id) AS linked_promotions
      FROM service_categories sc
      ORDER BY sc.sort_order, sc.code, sc.created_at
    `;

    const rows = categories.map((c) => ({
      id: c.id,
      code: c.code,
      name: c.name,
      displayName: c.name,
      description: c.description,
      iconKey: c.icon_key,
      capacity: c.capacity,
      baseFare: c.base_fare,
      perKmRate: c.per_km_rate,
      minFare: c.min_fare,
      status: c.is_active ? 'active' : 'inactive',
      isActive: c.is_active,
      sortOrder: c.sort_order,
      createdAt: c.created_at,
      updatedAt: c.updated_at,
      linkedDrivers: c.linked_drivers,
      linkedVehicles: c.linked_vehicles,
      linkedBookings: c.linked_bookings,
      linkedFareRules: 1, // fares live on service_categories row
      linkedPromotions: c.linked_promotions,
      normalizedBase: normalizeBase(String(c.code)) ?? normalizeBase(String(c.name)),
    }));

    const groups: Record<string, typeof rows> = {};
    for (const row of rows) {
      const key = row.normalizedBase ?? `other:${row.code}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(row);
    }

    const duplicateGroups = Object.entries(groups)
      .filter(([, list]) => list.length > 1 || (list[0]?.code && /[-_][0-9a-f]{4,}/i.test(String(list[0].code))))
      .map(([base, list]) => {
        const canonicalCandidate =
          list.find((r) => String(r.code).toLowerCase() === base) ??
          list.find((r) => r.isActive && r.linkedVehicles + r.linkedDrivers + r.linkedBookings > 0) ??
          list[0];

        const duplicates = list.filter((r) => r.id !== canonicalCandidate?.id);

        return {
          base,
          canonicalProposal: canonicalCandidate
            ? {
                id: canonicalCandidate.id,
                code: canonicalCandidate.code,
                name: canonicalCandidate.name,
                linkedDrivers: canonicalCandidate.linkedDrivers,
                linkedVehicles: canonicalCandidate.linkedVehicles,
                linkedBookings: canonicalCandidate.linkedBookings,
                linkedPromotions: canonicalCandidate.linkedPromotions,
              }
            : null,
          members: list.map((r) => ({
            id: r.id,
            code: r.code,
            name: r.name,
            isActive: r.isActive,
            linkedDrivers: r.linkedDrivers,
            linkedVehicles: r.linkedVehicles,
            linkedBookings: r.linkedBookings,
            linkedPromotions: r.linkedPromotions,
            isCanonicalProposal: r.id === canonicalCandidate?.id,
          })),
          duplicateCount: duplicates.length,
          mergePlan: duplicates.map((d) => ({
            duplicateCategoryId: d.id,
            canonicalCategoryId: canonicalCandidate?.id ?? null,
            linkedDrivers: d.linkedDrivers,
            linkedVehicles: d.linkedVehicles,
            linkedBookings: d.linkedBookings,
            linkedPromotions: d.linkedPromotions,
            linkedFareRules: 1,
            mergeSafety:
              d.linkedBookings > 0
                ? 'preserve_booking_fk_or_map'
                : d.linkedPromotions > 0
                  ? 'manual_review_promotions'
                  : 'safe_to_repoint_and_deactivate',
            conflicts:
              canonicalCandidate &&
              String(d.baseFare) === String(canonicalCandidate.baseFare) &&
              String(d.perKmRate) === String(canonicalCandidate.perKmRate)
                ? []
                : ['fare_rate_differs_from_canonical'],
          })),
        };
      });

    const rootCauseNotes = {
      seedSource:
        '0011 legacy (ride/bike/cng/moto/premium/comfort) + 0033 DriveWize (economy/executive/suv/van/minivan/ada)',
      productionInsertPaths: 'none found in src/',
      testInsertPatterns: [
        'tests/admin-fleet-vehicle-update.test.ts → BIKE-${uuid.slice(0,8)} / Bike ${runId}',
        'tests/helpers/vehicleExchange.fixtures.ts → ride-${uuid} / Ride ${runId}',
      ],
      quoteSurfacesAllActive:
        'src/services/fare.service.ts buildQuotesFromRoute → listActiveServiceCategories()',
      adminSurfacesAllActive:
        'src/controllers/adminBooking.controller.ts listCategoriesHandler',
      uniqueConstraint: 'code UNIQUE; name NOT unique → Bike + BIKE-xxxx both allowed',
    };

    const report = {
      generatedAt: new Date().toISOString(),
      mode: 'report-only',
      totalCategories: rows.length,
      activeCategories: rows.filter((r) => r.isActive).length,
      inactiveCategories: rows.filter((r) => !r.isActive).length,
      canonicalBases: CANONICAL_BASES,
      categories: rows,
      duplicateGroups,
      cleanupRequired: duplicateGroups.some((g) => g.duplicateCount > 0 || g.members.length > 1),
      finalStatus: duplicateGroups.some((g) => g.members.filter((m) => m.isActive).length > 1)
        ? 'SERVICE CATEGORY CLEANUP REQUIRED'
        : 'SERVICE CATEGORIES CLEAN',
      rootCauseNotes,
    };

    const outDir = join(process.cwd(), 'reports');
    mkdirSync(outDir, { recursive: true });
    const outPath = join(outDir, `service-category-audit-${Date.now()}.json`);
    writeFileSync(outPath, JSON.stringify(report, null, 2));

    console.log(
      JSON.stringify(
        {
          outPath,
          totalCategories: report.totalCategories,
          activeCategories: report.activeCategories,
          duplicateGroupCount: duplicateGroups.length,
          finalStatus: report.finalStatus,
          summary: duplicateGroups.map((g) => ({
            base: g.base,
            members: g.members.length,
            activeMembers: g.members.filter((m) => m.isActive).length,
            canonical: g.canonicalProposal?.code,
          })),
        },
        null,
        2
      )
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
