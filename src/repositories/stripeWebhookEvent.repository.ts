import { eq } from 'drizzle-orm';
import { db } from '../db/connection';
import { stripeWebhookEvents } from '../db/schema/stripe_webhook_events';
import { StripeWebhookProcessingStatus } from '../constants/payment';

export type WebhookClaimResult =
  | { action: 'process' }
  | { action: 'skip_processed' }
  | { action: 'in_flight' };

function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: string })?.code;
  const causeCode = (error as { cause?: { code?: string } })?.cause?.code;
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  return (
    code === '23505' ||
    causeCode === '23505' ||
    message.includes('duplicate key') ||
    message.includes('unique constraint')
  );
}

export async function findStripeWebhookEventByStripeId(stripeEventId: string) {
  const rows = await db
    .select()
    .from(stripeWebhookEvents)
    .where(eq(stripeWebhookEvents.stripeEventId, stripeEventId))
    .limit(1);
  return rows[0] ?? null;
}

export async function claimStripeWebhookEvent(
  stripeEventId: string,
  eventType: string
): Promise<WebhookClaimResult> {
  try {
    const [inserted] = await db
      .insert(stripeWebhookEvents)
      .values({
        stripeEventId,
        eventType,
        processingStatus: StripeWebhookProcessingStatus.RECEIVED,
      })
      .onConflictDoNothing()
      .returning();

    if (inserted) {
      return { action: 'process' };
    }
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error;
    }
  }

  const existing = await findStripeWebhookEventByStripeId(stripeEventId);
  if (!existing) {
    throw new Error('Webhook event claim failed');
  }

  if (existing.processingStatus === StripeWebhookProcessingStatus.PROCESSED) {
    return { action: 'skip_processed' };
  }

  if (existing.processingStatus === StripeWebhookProcessingStatus.FAILED) {
    await db
      .update(stripeWebhookEvents)
      .set({
        processingStatus: StripeWebhookProcessingStatus.RECEIVED,
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(stripeWebhookEvents.id, existing.id));
    return { action: 'process' };
  }

  return { action: 'in_flight' };
}

export async function markStripeWebhookEventProcessed(stripeEventId: string): Promise<void> {
  await db
    .update(stripeWebhookEvents)
    .set({
      processingStatus: StripeWebhookProcessingStatus.PROCESSED,
      processedAt: new Date(),
      lastError: null,
      updatedAt: new Date(),
    })
    .where(eq(stripeWebhookEvents.stripeEventId, stripeEventId));
}

export async function markStripeWebhookEventFailed(
  stripeEventId: string,
  error: unknown
): Promise<void> {
  const lastError = error instanceof Error ? error.message.slice(0, 2000) : 'Unknown error';
  await db
    .update(stripeWebhookEvents)
    .set({
      processingStatus: StripeWebhookProcessingStatus.FAILED,
      lastError,
      updatedAt: new Date(),
    })
    .where(eq(stripeWebhookEvents.stripeEventId, stripeEventId));
}
