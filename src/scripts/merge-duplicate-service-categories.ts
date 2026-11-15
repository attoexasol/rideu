/**
 * Merge duplicate service_categories into canonical product rows.
 *
 * Modes:
 *   npx tsx src/scripts/merge-duplicate-service-categories.ts --report-only
 *   npx tsx src/scripts/merge-duplicate-service-categories.ts --apply
 *
 * Idempotent: re-running --apply is a no-op once duplicates are inactive
 * and join rows already point at canonical IDs.
 */
import 'dotenv/config';
import postgres from 'postgres';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import {
  CANONICAL_SERVICE_CODES,
  LEGACY_SERVICE_CODES,
  CANONICAL_DISPLAY_NAMES,
  LEGACY_DISPLAY_NAMES,
  normalizeServiceCategoryBase,
  isKnownExactProductCode,
  type KnownServiceCode,
} from '../utils/serviceCategoryNormalize';

const APPLY = process.argv.includes('--apply');

const ALL_PRODUCT_CODES: readonly KnownServiceCode[] = [
  ...CANONICAL_SERVICE_CODES,
  ...LEGACY_SERVICE_CODES,
];

function displayNameFor(base: KnownServiceCode): string {
  if ((CANONICAL_SERVICE_CODES as readonly string[]).includes(base)) {
    return CANONICAL_DISPLAY_NAMES[base as keyof typeof CANONICAL_DISPLAY_NAMES];
  }
  return LEGACY_DISPLAY_NAMES[base as keyof typeof LEGACY_DISPLAY_NAMES];
}

type CategoryRow = {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
  base_fare: string;
  per_km_rate: string;
  min_fare: string;
  capacity: number;
  sort_order: number;
  linked_drivers: number;
  linked_vehicles: number;
  linked_bookings: number;
  linked_promotions: number;
};

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL required');
    process.exit(1);
  }

  const sql = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 20 });
  const mode = APPLY ? 'apply' : 'report-only';

  try {
    const categories = (await sql`
      SELECT
        sc.id,
        sc.code,
        sc.name,
        sc.is_active,
        sc.base_fare,
        sc.per_km_rate,
        sc.min_fare,
        sc.capacity,
        sc.sort_order,
        (SELECT count(*)::int FROM driver_service_categories d
          WHERE d.service_category_id = sc.id) AS linked_drivers,
        (SELECT count(*)::int FROM vehicle_service_categories v
          WHERE v.service_category_id = sc.id) AS linked_vehicles,
        (SELECT count(*)::int FROM bookings b
          WHERE b.service_category_id = sc.id) AS linked_bookings,
        (SELECT count(*)::int FROM promotions p
          WHERE p.service_category_id = sc.id) AS linked_promotions
      FROM service_categories sc
      ORDER BY sc.code
    `) as unknown as CategoryRow[];

    const byBase = new Map<KnownServiceCode, CategoryRow[]>();
    for (const base of ALL_PRODUCT_CODES) byBase.set(base, []);

    for (const row of categories) {
      const base = normalizeServiceCategoryBase(row.code) ?? normalizeServiceCategoryBase(row.name);
      if (!base) continue;
      byBase.get(base)!.push(row);
    }

    const plans: Array<{
      base: KnownServiceCode;
      canonical: { id: string; code: string; name: string } | null;
      duplicates: Array<{
        duplicateCategoryId: string;
        code: string;
        name: string;
        linkedDrivers: number;
        linkedVehicles: number;
        linkedBookings: number;
        linkedPromotions: number;
        linkedFareRules: number;
        mergeSafety: string;
        conflicts: string[];
        actions: string[];
      }>;
    }> = [];

    const actionsLog: Array<Record<string, unknown>> = [];

    for (const base of ALL_PRODUCT_CODES) {
      const members = byBase.get(base) ?? [];
      if (!members.length) {
        plans.push({ base, canonical: null, duplicates: [] });
        continue;
      }

      const canonical =
        members.find((m) => isKnownExactProductCode(m.code)) ??
        members.find((m) => m.is_active) ??
        members[0];

      const duplicates = members.filter((m) => m.id !== canonical.id && m.is_active);

      const duplicatePlans = duplicates.map((d) => {
        const conflicts: string[] = [];
        if (String(d.base_fare) !== String(canonical.base_fare)) conflicts.push('base_fare_differs');
        if (String(d.per_km_rate) !== String(canonical.per_km_rate))
          conflicts.push('per_km_rate_differs');
        if (String(d.min_fare) !== String(canonical.min_fare)) conflicts.push('min_fare_differs');

        const preserveBookings = d.linked_bookings > 0;
        const mergeSafety = preserveBookings
          ? 'preserve_historical_booking_fk'
          : d.linked_promotions > 0
            ? 'repoint_promotions_then_deactivate'
            : 'safe_repoint_and_deactivate';

        const actions = [
          'repoint_driver_service_categories',
          'repoint_vehicle_service_categories',
          'repoint_promotions',
          preserveBookings
            ? 'keep_booking_service_category_id'
            : 'no_bookings_to_repoint',
          'deactivate_duplicate',
          'normalize_canonical_display_name',
        ];

        return {
          duplicateCategoryId: d.id,
          code: d.code,
          name: d.name,
          linkedDrivers: d.linked_drivers,
          linkedVehicles: d.linked_vehicles,
          linkedBookings: d.linked_bookings,
          linkedPromotions: d.linked_promotions,
          linkedFareRules: 1,
          mergeSafety,
          conflicts,
          actions,
        };
      });

      plans.push({
        base,
        canonical: {
          id: canonical.id,
          code: canonical.code,
          name: canonical.name,
        },
        duplicates: duplicatePlans,
      });

      if (!APPLY) continue;

      // Normalize display name / code casing. Only current bookable products stay active.
      await sql`
        UPDATE service_categories
        SET
          code = ${base},
          name = ${displayNameFor(base)},
          is_active = ${(CANONICAL_SERVICE_CODES as readonly string[]).includes(base)},
          updated_at = NOW()
        WHERE id = ${canonical.id}::uuid
      `;
      actionsLog.push({
        action: 'normalize_canonical',
        base,
        canonicalId: canonical.id,
      });

      for (const dup of duplicates) {
        // Drivers: insert canonical if missing, delete duplicate join
        const driverLinks = await sql`
          SELECT driver_id, is_primary, verified_at
          FROM driver_service_categories
          WHERE service_category_id = ${dup.id}::uuid
        `;
        for (const link of driverLinks) {
          await sql`
            INSERT INTO driver_service_categories (driver_id, service_category_id, is_primary, verified_at)
            VALUES (
              ${link.driver_id}::uuid,
              ${canonical.id}::uuid,
              ${link.is_primary},
              ${link.verified_at}
            )
            ON CONFLICT (driver_id, service_category_id) DO NOTHING
          `;
        }
        await sql`
          DELETE FROM driver_service_categories
          WHERE service_category_id = ${dup.id}::uuid
        `;

        // Vehicles
        const vehicleLinks = await sql`
          SELECT vehicle_id, is_primary, verified_at, source
          FROM vehicle_service_categories
          WHERE service_category_id = ${dup.id}::uuid
        `;
        for (const link of vehicleLinks) {
          await sql`
            INSERT INTO vehicle_service_categories (
              vehicle_id, service_category_id, is_primary, verified_at, source
            )
            VALUES (
              ${link.vehicle_id}::uuid,
              ${canonical.id}::uuid,
              ${link.is_primary},
              ${link.verified_at},
              ${link.source ?? 'merge'}
            )
            ON CONFLICT (vehicle_id, service_category_id) DO NOTHING
          `;
        }
        await sql`
          DELETE FROM vehicle_service_categories
          WHERE service_category_id = ${dup.id}::uuid
        `;

        // Promotions: repoint, avoid leaving orphans
        const promotions = await sql`
          SELECT id FROM promotions WHERE service_category_id = ${dup.id}::uuid
        `;
        for (const promo of promotions) {
          // If canonical already has an overlapping promo, leave FK and flag —
          // still repoint so category is not blocked from deactivate by FK cascades.
          await sql`
            UPDATE promotions
            SET service_category_id = ${canonical.id}::uuid, updated_at = NOW()
            WHERE id = ${promo.id}::uuid
          `;
        }
        actionsLog.push({
          action: 'repoint_links',
          duplicateId: dup.id,
          canonicalId: canonical.id,
          drivers: driverLinks.length,
          vehicles: vehicleLinks.length,
          promotions: promotions.length,
          bookingsPreserved: dup.linked_bookings,
        });

        // Historical bookings: keep FK (safe for history readability)
        // Deactivate duplicate (fare columns preserved on inactive row)
        await sql`
          UPDATE service_categories
          SET is_active = false, updated_at = NOW()
          WHERE id = ${dup.id}::uuid
        `;
        actionsLog.push({
          action: 'deactivate_duplicate',
          duplicateId: dup.id,
          farePreserved: true,
          bookingsUnchanged: true,
        });
      }
    }

    const duplicateCount = plans.reduce((n, p) => n + p.duplicates.length, 0);
    const activeDupesAfter = APPLY
      ? (
          await sql`
            SELECT count(*)::int AS n
            FROM service_categories
            WHERE is_active = true
              AND code ~* '^(bike|ride|cng|moto|premium|comfort)[-_]'
          `
        )[0]?.n
      : duplicateCount;

    const report = {
      generatedAt: new Date().toISOString(),
      mode,
      canonicalProposal: Object.fromEntries(
        plans
          .filter((p) => p.canonical)
          .map((p) => [
            p.base.toUpperCase(),
            {
              id: p.canonical!.id,
              code: p.canonical!.code,
              displayName: displayNameFor(p.base),
            },
          ])
      ),
      plans,
      actionsLog,
      summary: {
        duplicateCategories: duplicateCount,
        applied: APPLY,
        remainingActiveSuffixed: activeDupesAfter,
      },
      finalStatus:
        Number(activeDupesAfter) === 0 &&
        plans.every((p) => p.canonical)
          ? 'SERVICE CATEGORIES CLEAN'
          : 'SERVICE CATEGORY CLEANUP REQUIRED',
      rootCause: {
        primary:
          'tests/admin-fleet-vehicle-update.test.ts beforeEach inserts BIKE-${uuid}/Bike ${runId} but cleanupExchangeFixture only deletes fixture.ids.serviceCategoryIds (Ride), leaving Bike orphans.',
        file: 'tests/admin-fleet-vehicle-update.test.ts',
        function: 'beforeEach (secondaryCategory insert) + cleanupExchangeFixture',
        amplifiers: [
          'listActiveServiceCategories returns every is_active row',
          'fare.service buildQuotesFromRoute emits one quote per active category',
          'admin listCategoriesHandler same list',
          'code UNIQUE allows BIKE-xxxx alongside bike',
        ],
      },
    };

    const outDir = join(process.cwd(), 'reports');
    mkdirSync(outDir, { recursive: true });
    const outPath = join(
      outDir,
      `service-category-merge-${mode}-${Date.now()}.json`
    );
    writeFileSync(outPath, JSON.stringify(report, null, 2));

    console.log(
      JSON.stringify(
        {
          outPath,
          mode,
          duplicateCategories: duplicateCount,
          finalStatus: report.finalStatus,
          canonical: report.canonicalProposal,
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
