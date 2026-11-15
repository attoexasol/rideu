/**
 * Insert a reviewed GeoJSON boundary as a draft, and optionally activate it.
 * This script does not contain a Coronado (or any other) boundary.
 *
 * Draft only:
 *   npx tsx src/scripts/activate-service-area.ts --file ./boundary.geojson --market US --code coronado --name "Coronado" --source-label "Approved city extract"
 *
 * Activate a newly inserted file after approval:
 *   npx tsx src/scripts/activate-service-area.ts --file ./boundary.geojson --market US --code coronado --name "Coronado" --source-label "Approved city extract" --activate
 *
 * Activate an existing draft without inserting another copy:
 *   npx tsx src/scripts/activate-service-area.ts --activate --id <draft-uuid>
 */
import 'dotenv/config';
import { readFileSync } from 'fs';
import { activateServiceArea, createServiceAreaDraft } from '../services/serviceArea.service';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

async function main(): Promise<void> {
  const file = arg('--file');
  const market = arg('--market');
  const code = arg('--code');
  const name = arg('--name');
  const sourceLabel = arg('--source-label');
  const sourceUrl = arg('--source-url');
  const existingId = arg('--id');
  const activate = process.argv.includes('--activate');

  if (existingId) {
    if (!activate) {
      throw new Error('--id only activates an existing draft. Pass --activate as well.');
    }
    const active = await activateServiceArea(existingId);
    console.log(
      JSON.stringify({
        id: active.id,
        marketCode: active.marketCode,
        code: active.code,
        version: active.version,
        status: active.status,
        enforcementEnabled: active.enforcementEnabled,
        approvedAt: active.approvedAt,
      })
    );
    process.exit(0);
  }

  if (!file || !market || !code || !name) {
    throw new Error('Required: --file --market --code --name');
  }

  const geometry = JSON.parse(readFileSync(file, 'utf8')) as unknown;
  const draft = await createServiceAreaDraft({
    marketCode: market,
    code,
    name,
    geometry,
    sourceLabel,
    sourceUrl,
  });
  console.log(
    JSON.stringify({
      id: draft.id,
      marketCode: draft.marketCode,
      code: draft.code,
      version: draft.version,
      status: draft.status,
      enforcementEnabled: draft.enforcementEnabled,
    })
  );

  if (!activate) {
    console.log('Draft saved. Enforcement was not enabled. Re-run with --activate after approval.');
    process.exit(0);
  }

  const active = await activateServiceArea(draft.id);
  console.log(
    JSON.stringify({
      id: active.id,
      status: active.status,
      enforcementEnabled: active.enforcementEnabled,
      approvedAt: active.approvedAt,
    })
  );
  process.exit(0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
