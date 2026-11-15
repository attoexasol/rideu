import { and, eq } from 'drizzle-orm';
import { db } from '../db/connection';
import { driverDocuments, type DriverDocument } from '../db/schema/driver_documents';
import { drivers } from '../db/schema/drivers';
import type { DriverDocumentType } from '../config/driverDocuments';

export async function driverExists(driverId: string): Promise<boolean> {
  const rows = await db.select({ id: drivers.id }).from(drivers).where(eq(drivers.id, driverId)).limit(1);
  return Boolean(rows[0]);
}

export async function listDriverDocuments(driverId: string): Promise<DriverDocument[]> {
  return db
    .select()
    .from(driverDocuments)
    .where(eq(driverDocuments.driverId, driverId));
}

export async function findDriverDocument(
  driverId: string,
  documentType: DriverDocumentType
): Promise<DriverDocument | null> {
  const rows = await db
    .select()
    .from(driverDocuments)
    .where(
      and(eq(driverDocuments.driverId, driverId), eq(driverDocuments.documentType, documentType))
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function upsertDriverDocument(input: {
  driverId: string;
  documentType: DriverDocumentType;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
}): Promise<{ current: DriverDocument; previousStorageKey: string | null }> {
  const existing = await findDriverDocument(input.driverId, input.documentType);
  const now = new Date();

  if (existing) {
    const rows = await db
      .update(driverDocuments)
      .set({
        originalFilename: input.originalFilename,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        storageKey: input.storageKey,
        uploadedAt: now,
        updatedAt: now,
      })
      .where(eq(driverDocuments.id, existing.id))
      .returning();
    return { current: rows[0], previousStorageKey: existing.storageKey };
  }

  const rows = await db
    .insert(driverDocuments)
    .values({
      driverId: input.driverId,
      documentType: input.documentType,
      originalFilename: input.originalFilename,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      storageKey: input.storageKey,
      uploadedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return { current: rows[0], previousStorageKey: null };
}
