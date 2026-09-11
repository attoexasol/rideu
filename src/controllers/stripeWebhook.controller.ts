import { Request, Response } from 'express';
import { sendError, sendSuccess } from '../utils/response';
import { PaymentError } from '../services/payment.errors';
import { processStripeWebhookRawBody } from '../services/stripeWebhook.service';

function asRawBody(body: unknown): Buffer | string | null {
  if (Buffer.isBuffer(body)) return body;
  if (typeof body === 'string') return body;
  return null;
}

export async function stripeWebhookHandler(req: Request, res: Response) {
  const signature = req.header('stripe-signature');
  const rawBody = asRawBody(req.body);

  if (!rawBody) {
    return sendError(
      res,
      'STRIPE_WEBHOOK_RAW_BODY_REQUIRED',
      'Webhook body must be the raw JSON payload.',
      400
    );
  }

  try {
    const result = await processStripeWebhookRawBody(rawBody, signature);
    return sendSuccess(res, {
      received: true,
      duplicate: result.duplicate,
      eventId: result.eventId,
      eventType: result.eventType,
    });
  } catch (error) {
    if (error instanceof PaymentError) {
      return sendError(res, error.code, error.message, error.statusCode);
    }
    const message = error instanceof Error ? error.message : 'Webhook processing failed';
    return sendError(res, 'STRIPE_WEBHOOK_PROCESSING_FAILED', message, 500);
  }
}
