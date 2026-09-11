/**
 * Single source for the active Admin commission split.
 * Airport fees are fixed per-airport amounts and are not configured here.
 */

import {
  PERCENTAGE_TOTAL_SCALED,
  percentageToScaled,
  scaledToPercentageString,
} from '../utils/money';
import {
  findActiveSettlementSettings,
  findLatestSettlementSettingsVersion,
  insertSettlementSettings,
  replaceActiveSettlementSettings,
} from '../repositories/settlementSettings.repository';
import { SettlementRulesNotConfiguredError, SettlementSettingsError } from './payment.errors';

export interface ActiveSettlementSettings {
  id: string;
  driverPercentage: string;
  companyPercentage: string;
  version: number;
  updatedAt: Date;
}

export interface SettlementSettingsView {
  driverPercentage: string;
  companyPercentage: string;
  version: number;
  updatedAt: string;
}

export function parseSettlementPercentages(input: {
  driverPercentage: string | number;
  companyPercentage: string | number;
}): {
  driverPercentage: string;
  companyPercentage: string;
} {
  let driverScaled: number;
  let companyScaled: number;
  try {
    driverScaled = percentageToScaled(input.driverPercentage);
    companyScaled = percentageToScaled(input.companyPercentage);
  } catch (error) {
    throw new SettlementSettingsError(
      error instanceof Error ? error.message : 'Invalid settlement percentages'
    );
  }

  if (driverScaled < 0 || companyScaled < 0) {
    throw new SettlementSettingsError('Settlement percentages must not be negative');
  }
  if (driverScaled > PERCENTAGE_TOTAL_SCALED || companyScaled > PERCENTAGE_TOTAL_SCALED) {
    throw new SettlementSettingsError('Settlement percentages cannot exceed 100');
  }
  if (driverScaled + companyScaled !== PERCENTAGE_TOTAL_SCALED) {
    throw new SettlementSettingsError('driverPercentage + companyPercentage must equal 100');
  }

  return {
    driverPercentage: scaledToPercentageString(driverScaled),
    companyPercentage: scaledToPercentageString(companyScaled),
  };
}

function toActive(row: {
  id: string;
  driverPercentage: string;
  companyPercentage: string;
  version: number;
  updatedAt: Date;
}): ActiveSettlementSettings {
  return {
    id: row.id,
    driverPercentage: scaledToPercentageString(percentageToScaled(row.driverPercentage)),
    companyPercentage: scaledToPercentageString(percentageToScaled(row.companyPercentage)),
    version: row.version,
    updatedAt: row.updatedAt,
  };
}

export function toSettlementSettingsView(row: ActiveSettlementSettings): SettlementSettingsView {
  return {
    driverPercentage: row.driverPercentage,
    companyPercentage: row.companyPercentage,
    version: row.version,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getActiveSettlementSettings(): Promise<ActiveSettlementSettings> {
  const row = await findActiveSettlementSettings();
  if (!row) {
    throw new SettlementRulesNotConfiguredError(
      'No active settlement settings are configured'
    );
  }
  return toActive(row);
}

export async function getSettlementSettingsForAdmin(): Promise<SettlementSettingsView> {
  return toSettlementSettingsView(await getActiveSettlementSettings());
}

export async function updateActiveSettlementSettings(input: {
  driverPercentage: string | number;
  companyPercentage: string | number;
}): Promise<SettlementSettingsView> {
  const parsed = parseSettlementPercentages(input);
  const current = await findActiveSettlementSettings();
  const latestVersion = await findLatestSettlementSettingsVersion();
  const nextVersion = Math.max(latestVersion, current?.version ?? 0) + 1;
  const nextValues = {
    driverPercentage: parsed.driverPercentage,
    companyPercentage: parsed.companyPercentage,
    version: nextVersion,
    isActive: true,
  };

  const saved = current
    ? await replaceActiveSettlementSettings({ currentId: current.id, next: nextValues })
    : await insertSettlementSettings(nextValues);

  return toSettlementSettingsView(toActive(saved));
}
