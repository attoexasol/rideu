import { desc, eq } from 'drizzle-orm';
import { db } from '../db/connection';
import {
  settlementSettings,
  type NewSettlementSettings,
  type SettlementSettings,
} from '../db/schema/settlement_settings';

export async function findActiveSettlementSettings(): Promise<SettlementSettings | null> {
  const rows = await db
    .select()
    .from(settlementSettings)
    .where(eq(settlementSettings.isActive, true))
    .limit(1);
  return rows[0] ?? null;
}

export async function insertSettlementSettings(values: NewSettlementSettings) {
  const [row] = await db.insert(settlementSettings).values(values).returning();
  return row;
}

export async function replaceActiveSettlementSettings(input: {
  currentId: string;
  next: NewSettlementSettings;
}): Promise<SettlementSettings> {
  return db.transaction(async (tx) => {
    await tx
      .update(settlementSettings)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(settlementSettings.id, input.currentId));
    const [created] = await tx.insert(settlementSettings).values(input.next).returning();
    if (!created) {
      throw new Error('Failed to insert settlement settings');
    }
    return created;
  });
}

export async function findLatestSettlementSettingsVersion(): Promise<number> {
  const rows = await db
    .select({ version: settlementSettings.version })
    .from(settlementSettings)
    .orderBy(desc(settlementSettings.version))
    .limit(1);
  return rows[0]?.version ?? 0;
}
