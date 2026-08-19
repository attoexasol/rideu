import { Request, Response } from 'express';
import { sendSuccess, sendError, calculatePagination } from '../utils/response';
import { driverUtils } from '../db/utils';
import {
  acceptBookingOffer,
  rejectBookingOffer,
  getOfferDetailForDriver,
  type AcceptOfferResult,
} from '../services/dispatch.service';
import {
  updateBookingStatusByDriver,
  cancelBookingByDriver,
} from '../services/booking.service';
import { listPendingOffersForDriver } from '../repositories/booking.repository';
import {
  getDriverActiveBookingResponse,
  getDriverBookingDetailForDriver,
  buildOfferEventPayload,
} from '../services/driverBooking.service';
import { listDriverRideHistory } from '../services/rideHistory.service';
import { logger } from '../middleware/logger';

const ACCEPT_REQUEST_TIMEOUT_MS = parseInt(
  process.env.ACCEPT_REQUEST_TIMEOUT_MS || '15000',
  10
);

async function resolveDriver(req: Request) {
  const user = (req as any).user;
  return driverUtils.findByAuth0Id(user.auth0Id);
}

function acceptTimedOut(): Promise<AcceptOfferResult> {
  return new Promise((_, reject) => {
    setTimeout(() => {
      const err = new Error('Accept request timed out') as Error & { code: string };
      err.code = 'ACCEPT_TIMEOUT';
      reject(err);
    }, ACCEPT_REQUEST_TIMEOUT_MS);
  });
}

export async function listOffersHandler(req: Request, res: Response) {
  const driver = await resolveDriver(req);
  if (!driver) return sendError(res, 'NOT_FOUND', 'Driver not found', 404);
  const rows = await listPendingOffersForDriver(driver.id);
  const offers = await Promise.all(
    rows.map(async (row) => {
      const payload = await buildOfferEventPayload(
        row.offer.id,
        row.booking.id,
        driver.id,
        row.offer.expiresAt,
        row.offer.distanceToPickupKm ? parseFloat(row.offer.distanceToPickupKm) : 0
      );
      return payload;
    })
  );
  return sendSuccess(res, offers.filter(Boolean));
}

export async function listPendingOffersHandler(req: Request, res: Response) {
  return listOffersHandler(req, res);
}

export async function listBookingsHandler(req: Request, res: Response) {
  const driver = await resolveDriver(req);
  if (!driver) return sendError(res, 'NOT_FOUND', 'Driver not found', 404);
  const page = Number((req.query as any).page) || 1;
  const limit = Number((req.query as any).limit) || 20;
  const filter = ((req.query as any).filter as 'all' | 'completed' | 'cancelled') || 'all';
  const result = await listDriverRideHistory(driver.id, page, limit, filter);
  return sendSuccess(res, result.items, 200, {
    pagination: calculatePagination(result.total, page, limit),
  });
}

export async function getOfferHandler(req: Request, res: Response) {
  const driver = await resolveDriver(req);
  if (!driver) return sendError(res, 'NOT_FOUND', 'Driver not found', 404);
  const offer = await getOfferDetailForDriver(req.params.offerId, driver.id);
  if (!offer) return sendError(res, 'OFFER_NOT_FOUND', 'Offer not found or expired', 404);
  return sendSuccess(res, offer);
}

export async function activeBookingHandler(req: Request, res: Response) {
  const driver = await resolveDriver(req);
  if (!driver) return sendError(res, 'NOT_FOUND', 'Driver not found', 404);
  const data = await getDriverActiveBookingResponse(driver.id);
  return sendSuccess(res, data);
}

export async function getBookingHandler(req: Request, res: Response) {
  const driver = await resolveDriver(req);
  if (!driver) return sendError(res, 'NOT_FOUND', 'Driver not found', 404);
  const detail = await getDriverBookingDetailForDriver(req.params.bookingId, driver.id);
  if (!detail) return sendError(res, 'BOOKING_NOT_ASSIGNED', 'Booking not found or access denied', 404);
  return sendSuccess(res, detail);
}

export async function acceptOfferHandler(req: Request, res: Response) {
  const bookingId = req.params.bookingId;
  const offerId = req.body?.offerId as string | undefined;
  const driver = await resolveDriver(req);

  logger.info({
    event: 'driver.accept.request',
    bookingId,
    offerIdPresent: Boolean(offerId),
    offerId: offerId ?? null,
    authenticatedDriverResolved: Boolean(driver),
    driverId: driver?.id ?? null,
    timeoutMs: ACCEPT_REQUEST_TIMEOUT_MS,
  });

  if (!driver) return sendError(res, 'NOT_FOUND', 'Driver not found', 404);

  try {
    const result = await Promise.race([
      acceptBookingOffer(bookingId, driver.id, offerId),
      acceptTimedOut(),
    ]);

    if (!result.success) {
      const conflictCodes = new Set([
        'BOOKING_ALREADY_TAKEN',
        'BOOKING_ALREADY_CANCELLED',
        'BOOKING_NOT_AVAILABLE',
        'OFFER_EXPIRED',
        'BOOKING_LOCK_TIMEOUT',
      ]);
      const status = conflictCodes.has(result.code ?? '') ? 409 : 400;
      logger.info({
        event: 'driver.accept.response',
        bookingId,
        driverId: driver.id,
        success: false,
        httpStatus: status,
        code: result.code ?? 'ACCEPT_FAILED',
      });
      return sendError(res, result.code ?? 'ACCEPT_FAILED', result.message ?? 'Accept failed', status);
    }

    logger.info({
      event: 'driver.accept.response',
      bookingId,
      driverId: driver.id,
      success: true,
      httpStatus: 200,
      code: null,
    });
    return sendSuccess(res, result.booking);
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code === 'ACCEPT_TIMEOUT') {
      logger.warn({
        event: 'driver.accept.timeout',
        bookingId,
        driverId: driver.id,
        timeoutMs: ACCEPT_REQUEST_TIMEOUT_MS,
      });
      return sendError(res, 'ACCEPT_TIMEOUT', 'Accept request timed out', 504);
    }
    throw err;
  }
}

export async function rejectOfferHandler(req: Request, res: Response) {
  const driver = await resolveDriver(req);
  if (!driver) return sendError(res, 'NOT_FOUND', 'Driver not found', 404);
  await rejectBookingOffer(req.params.bookingId, driver.id, req.body?.reason);
  return sendSuccess(res, { message: 'Offer declined' });
}

export async function declineOfferHandler(req: Request, res: Response) {
  return rejectOfferHandler(req, res);
}

export async function updateStatusHandler(req: Request, res: Response) {
  try {
    const driver = await resolveDriver(req);
    if (!driver) return sendError(res, 'NOT_FOUND', 'Driver not found', 404);
    const updated = await updateBookingStatusByDriver(
      req.params.bookingId,
      driver.id,
      req.body.status
    );
    return sendSuccess(res, updated);
  } catch (e: any) {
    const code =
      e?.code === 'RECORDING_CONSENT_REQUIRED'
        ? 'RECORDING_CONSENT_REQUIRED'
        : e?.message?.includes('Cannot transition')
          ? 'INVALID_STATUS_TRANSITION'
          : 'STATUS_FAILED';
    const status = code === 'RECORDING_CONSENT_REQUIRED' ? 409 : 400;
    return sendError(res, code, e instanceof Error ? e.message : 'Update failed', status);
  }
}

export async function cancelBookingHandler(req: Request, res: Response) {
  try {
    const driver = await resolveDriver(req);
    if (!driver) return sendError(res, 'NOT_FOUND', 'Driver not found', 404);
    const updated = await cancelBookingByDriver(
      req.params.bookingId,
      driver.id,
      req.body?.reason
    );
    return sendSuccess(res, updated);
  } catch (e) {
    return sendError(res, 'CANCEL_FAILED', e instanceof Error ? e.message : 'Cancel failed', 400);
  }
}

export async function uploadVideoSegmentHandler(req: Request, res: Response) {
  try {
    const driver = await resolveDriver(req);
    if (!driver) return sendError(res, 'NOT_FOUND', 'Driver not found', 404);

    const file = (req as any).file;
    if (!file) return sendError(res, 'VALIDATION_ERROR', 'file is required', 400);

    const { sessionId, segmentIndex, durationSeconds } = req.body;
    const { uploadLiveChunkForBooking } = await import('../services/liveVideo.service');

    const segment = await uploadLiveChunkForBooking({
      bookingId: req.params.bookingId,
      sessionId,
      driverId: driver.id,
      buffer: file.buffer,
      mimeType: file.mimetype,
      segmentIndex: Number(segmentIndex),
      durationSeconds: durationSeconds ? Number(durationSeconds) : undefined,
    });

    return sendSuccess(res, segment, 201);
  } catch (e: any) {
    const code = e?.code ?? 'UPLOAD_FAILED';
    return sendError(res, code, e instanceof Error ? e.message : 'Upload failed', 400);
  }
}
