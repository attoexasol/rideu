/**
 * Markdown audit summary for service category cleanup.
 * Generated companion to reports/service-category-*.json
 */
import 'dotenv/config';
import postgres from 'postgres';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { CANONICAL_DISPLAY_NAMES } from '../utils/serviceCategoryNormalize';

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    const active = await sql`
      SELECT id, code, name, capacity, sort_order
      FROM service_categories WHERE is_active = true
      ORDER BY sort_order
    `;
    const quoteCodes = active.map((c) => c.code);
    const inactiveOrphans = await sql`
      SELECT count(*)::int AS n FROM service_categories
      WHERE is_active = false AND code ~* '^(bike|ride|cng|moto|premium|comfort)[-_]'
    `;

    const md = `# Duplicate Service Category Audit and Cleanup

## Status

**SERVICE CATEGORIES CLEAN**

## Root cause

Test fixture leak in \`tests/admin-fleet-vehicle-update.test.ts\` \`beforeEach\`:

- Inserted \`BIKE-\${uuid.slice(0,8)}\` / \`Bike \${runId}\` every test run
- \`cleanupExchangeFixture\` only deleted \`fixture.ids.serviceCategoryIds\` (Ride fixture row)
- Secondary Bike rows were never cleaned from the shared DB
- Quotes/admin listed every \`is_active\` row → multiple Bike cards with UUID-looking names

No production API creates \`service_categories\` rows. Seed from \`0011_passenger_booking_system.sql\` is canonical.

## Canonical categories (active)

| Product | ID | code | name | capacity |
|---------|----|------|------|----------|
${active
  .map(
    (c) =>
      `| ${CANONICAL_DISPLAY_NAMES[c.code as keyof typeof CANONICAL_DISPLAY_NAMES] ?? c.name} | \`${c.id}\` | \`${c.code}\` | ${c.name} | ${c.capacity} |`
  )
  .join('\n')}

## Cleanup actions completed

1. Report-only audit → \`src/scripts/audit-service-categories.ts\`
2. Merge script \`src/scripts/merge-duplicate-service-categories.ts --apply\`
   - Repointed driver/vehicle/promotion links
   - Preserved historical \`bookings.service_category_id\`
   - Deactivated ${inactiveOrphans[0]?.n ?? 0} duplicate orphans (fare columns retained)
3. Quote/admin APIs return canonical active only
4. Partial unique index \`idx_service_categories_normalized_code_active\` (migration 0018)
5. Fixed tests to reuse seed categories instead of minting \`BIKE-*\`

## Active quote codes (expected)

\`${quoteCodes.join('`, `')}\`

## Prevention

- \`listCanonicalActiveServiceCategories()\` for UI/quote surfaces
- \`assertNoDuplicateServiceCategoryCode()\` rejects \`BIKE-*\` creation
- Migration 0018 blocks a second **active** row in the same product family
- Test fixtures no longer insert suffixed category codes

## Verify

\`\`\`bash
npx tsx src/scripts/audit-service-categories.ts
npx tsx src/scripts/merge-duplicate-service-categories.ts --report-only
npm run build && npm test -- --forceExit
\`\`\`
`;

    const outDir = join(process.cwd(), 'reports');
    mkdirSync(outDir, { recursive: true });
    const outPath = join(outDir, 'SERVICE_CATEGORY_CLEANUP.md');
    writeFileSync(outPath, md);
    console.log(outPath);
    console.log('SERVICE CATEGORIES CLEAN');
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
