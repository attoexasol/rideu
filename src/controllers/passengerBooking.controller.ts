import { Request, Response } from 'express';
import { sendSuccess, sendError, calculatePagination } from '../utils/response';
import { handleGoogleMapsError } from '../utils/googleMapsHandler';
import { isGoogleMapsConfigured } from '../config/googleMaps';
import {
  autocompletePlaces,
  fetchPlaceDetails,
  reverseGeocode,
  getNearbyPickupSpots,
} from '../services/googleMaps/googleMaps.client';
import {
  listCustomerPlaceSuggestions,
  upsertCustomerPlace,
  updateCustomerPlace,
  deleteCustomerPlace,
  findCustomerPlaceById,
} from '../repositories/customer.repository';
import { haversineKm, estimateMinutesFromKm } from '../utils/geo';
import { maskPlateNumber } from '../services/googleMaps/googleMaps.mapper';
import {
  listActiveServiceCategories,
  listActivePromotions,
  listPaymentMethods,
} from '../repositories/serviceCategory.repository';
import {
  createBookingQuote,
  confirmBooking,
  cancelBookingByCustomer,
  BookingCancellationError,
  formatPassengerCancelResponse,
  getPassengerActiveBooking,
  formatPassengerBookingSnapshot,
  consentRecording,
  getBookingDetail,
  findBookingById,
} from '../services/booking.service';
import { listPassengerRideHistory } from '../services/rideHistory.service';
import { findNearbyDriversForCategory } from '../services/dispatch.service';
import { listLiveSegmentsByBooking } from '../services/liveVideo.service';
import { quoteAllServiceCategories } from '../services/fare.service';
import { previewRoute } from '../services/route.service';

function mapsConfigGuard(res: Response): boolean {
  if (!isGoogleMapsConfigured()) {
    sendError(res, 'GOOGLE_MAPS_CONFIG_ERROR', 'Map services are temporarily unavailable.', 503);
    return false;
  }
  return true;
}

export async function autocompleteHandler(req: Request, res: Response) {
  if (!mapsConfigGuard(res)) return;
  try {
    const { input, lat, lng, city, country, sessionToken } = req.query as any;
    const results = await autocompletePlaces(input, { lat, lng, city, country, sessionToken });
    return sendSuccess(res, results);
  } catch (error) {
    return handleGoogleMapsError(res, error);
  }
}

export async function placeDetailsHandler(req: Request, res: Response) {
  if (!mapsConfigGuard(res)) return;
  try {
    const { placeId, sessionToken } = req.query as any;
    const details = await fetchPlaceDetails(placeId, sessionToken);
    return sendSuccess(res, details);
  } catch (error) {
    return handleGoogleMapsError(res, error);
  }
}

export async function reverseGeocodeHandler(req: Request, res: Response) {
  if (!mapsConfigGuard(res)) return;
  try {
    const { lat, lng } = req.query as any;
    const data = await reverseGeocode(Number(lat), Number(lng));
    return sendSuccess(res, data);
  } catch (error) {
    return handleGoogleMapsError(res, error);
  }
}

export async function suggestionsHandler(req: Request, res: Response) {
  const user = (req as any).user;
  const { lat, lng, limit } = req.query as any;
  const max = limit != null ? Number(limit) : 15;
  const places = await listCustomerPlaceSuggestions(user.userId, max);
  const withDistance = places.map((p) => {
    let distanceKm: number | null = null;
    if (lat != null && lng != null) {
      distanceKm = haversineKm(
        Number(lat),
        Number(lng),
        parseFloat(p.latitude),
        parseFloat(p.longitude)
      );
    }
    return {
      id: p.id,
      label: p.label,
      address: p.address,
      latitude: parseFloat(p.latitude),
      longitude: parseFloat(p.longitude),
      placeId: p.placeId,
      placeType: p.placeType,
      distanceKm: distanceKm != null ? Math.round(distanceKm * 10) / 10 : null,
      lastUsedAt: p.lastUsedAt?.toISOString?.() ?? p.lastUsedAt,
    };
  });
  return sendSuccess(res, withDistance);
}

export async function pickupSpotsHandler(req: Request, res: Response) {
  if (!mapsConfigGuard(res)) return;
  try {
    const { lat, lng, address } = req.query as any;
    const spots = await getNearbyPickupSpots(Number(lat), Number(lng), address);
    return sendSuccess(res, spots);
  } catch (error) {
    return handleGoogleMapsError(res, error);
  }
}

export async function savePlaceHandler(req: Request, res: Response) {
  const user = (req as any).user;
  const { label, address, latitude, longitude, placeId, city, countryCode, placeType } = req.body;
  const row = await upsertCustomerPlace({
    customerId: user.userId,
    label,
    address,
    latitude: String(latitude),
    longitude: String(longitude),
    placeId: placeId ?? null,
    city: city ?? null,
    countryCode: countryCode ?? null,
    placeType: placeType ?? 'recent',
    lastUsedAt: new Date(),
  });
  return sendSuccess(res, formatPlaceRow(row), 201);
}

export async function updatePlaceHandler(req: Request, res: Response) {
  const user = (req as any).user;
  const existing = await findCustomerPlaceById(user.userId, req.params.placeId);
  if (!existing) {
    return sendError(res, 'NOT_FOUND', 'Place not found', 404);
  }
  const body = req.body;
  const patch: Record<string, unknown> = {};
  if (body.label != null) patch.label = body.label;
  if (body.address != null) patch.address = body.address;
  if (body.latitude != null) patch.latitude = String(body.latitude);
  if (body.longitude != null) patch.longitude = String(body.longitude);
  if (body.placeId != null) patch.placeId = body.placeId;
  if (body.city != null) patch.city = body.city;
  if (body.countryCode != null) patch.countryCode = body.countryCode;
  if (body.placeType != null) patch.placeType = body.placeType;

  const row = await updateCustomerPlace(user.userId, req.params.placeId, patch as any);
  return sendSuccess(res, formatPlaceRow(row!));
}

export async function deletePlaceHandler(req: Request, res: Response) {
  const user = (req as any).user;
  const deleted = await deleteCustomerPlace(user.userId, req.params.placeId);
  if (!deleted) {
    return sendError(res, 'NOT_FOUND', 'Place not found', 404);
  }
  return sendSuccess(res, { id: deleted.id, deleted: true });
}

function formatPlaceRow(row: {
  id: string;
  label: string;
  address: string;
  latitude: string;
  longitude: string;
  placeId: string | null;
  city: string | null;
  countryCode: string | null;
  placeType: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    label: row.label,
    address: row.address,
    latitude: parseFloat(row.latitude),
    longitude: parseFloat(row.longitude),
    placeId: row.placeId,
    city: row.city,
    countryCode: row.countryCode,
    placeType: row.placeType,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function routePreviewHandler(req: Request, res: Response) {
  if (!mapsConfigGuard(res)) return;
  try {
    const { pickup, dropoff, stops, travelMode, routePreference } = req.body;
    const route = await previewRoute({ pickup, dropoff, stops, travelMode, routePreference });
    return sendSuccess(res, route);
  } catch (error) {
    return handleGoogleMapsError(res, error);
  }
}

export async function servicesHandler(_req: Request, res: Response) {
  const [services, promotions] = await Promise.all([
    listActiveServiceCategories(),
    listActivePromotions(),
  ]);
  const filtered = services
    .filter((s) => s.code !== 'rental')
    .map((s) => ({
      serviceCategoryId: s.id,
      code: s.code.toUpperCase(),
      name: s.name,
      displayName: s.name,
      description: s.description,
      iconKey: s.iconKey,
      capacity: s.capacity,
      baseFare: s.baseFare,
      perKmRate: s.perKmRate,
      minFare: s.minFare,
      sortOrder: s.sortOrder,
    }));
  return sendSuccess(res, { services: filtered, promotions });
}

export async function paymentMethodsHandler(_req: Request, res: Response) {
  const methods = await listPaymentMethods();
  return sendSuccess(
    res,
    methods.filter((m) => m.isActive)
  );
}

export async function quoteHandler(req: Request, res: Response) {
  try {
    const { pickup, dropoff, stops, serviceCategoryId } = req.body;
    const waypoints =
      stops?.map((s: any) => ({
        latitude: s.latitude,
        longitude: s.longitude,
        address: s.address,
      })) ?? [];

    if (serviceCategoryId) {
      const quote = await createBookingQuote({
        customerId: (req as any).user?.userId ?? 'quote',
        serviceCategoryId,
        pickup: { ...pickup, address: pickup.address ?? '' },
        dropoff: { ...dropoff, address: dropoff.address ?? '' },
        stops,
      });
      return sendSuccess(res, {
        route: quote.route,
        quotes: [
          {
            serviceCategoryId: quote.serviceCategoryId,
            serviceCode: quote.serviceCode,
            serviceName: quote.serviceName,
            description: quote.description,
            iconKey: quote.iconKey,
            capacity: quote.capacity,
            distanceKm: quote.distanceKm,
            durationMin: quote.durationMin,
            driverEtaMinutes: quote.driverEtaMinutes,
            originalFare: quote.originalFare,
            discountType: quote.discountType,
            discountValue: quote.discountValue,
            discountAmount: quote.discountAmount,
            finalFare: quote.finalFare,
            currency: quote.currency,
            promotion: quote.promotion,
          },
        ],
      });
    }

    const etaMap = new Map<string, number>();
    const categories = await listActiveServiceCategories();
    for (const cat of categories) {
      if (cat.code === 'rental') continue;
      const nearby = await findNearbyDriversForCategory(cat.id, pickup.latitude, pickup.longitude);
      if (nearby[0]) {
        etaMap.set(cat.id, estimateMinutesFromKm(nearby[0].distanceKm));
      }
    }

    const result = await quoteAllServiceCategories(pickup, dropoff, waypoints, etaMap);
    return sendSuccess(res, result);
  } catch (error) {
    return handleGoogleMapsError(res, error);
  }
}

export async function createBookingHandler(req: Request, res: Response) {
  const requestId = String(req.headers['x-request-id'] ?? `req_${Date.now()}`);
  const user = (req as any).user;
  try {
    const idempotencyKey = req.header('Idempotency-Key') ?? undefined;
    const booking = await confirmBooking({
      ...req.body,
      customerId: user.userId,
      idempotencyKey,
    });
    console.info('[BookingCreate] success', {
      requestId,
      customerId: user.userId,
      bookingId: booking.id,
      status: booking.status,
    });
    return sendSuccess(res, booking, 201);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Booking failed';
    const code = message.includes('active booking')
      ? 'ACTIVE_BOOKING_EXISTS'
      : 'BOOKING_CREATION_FAILED';
    console.warn('[BookingCreate] failed', {
      requestId,
      customerId: user?.userId,
      code,
      message,
      status: 400,
      serviceCategoryId: req.body?.serviceCategoryId,
    });
    return sendError(res, code, message, 400);
  }
}

export async function listBookingsHandler(req: Request, res: Response) {
  const user = (req as any).user;
  const page = Number((req.query as any).page) || 1;
  const limit = Number((req.query as any).limit) || 20;
  const filter = ((req.query as any).filter as 'all' | 'completed' | 'cancelled') || 'all';
  const result = await listPassengerRideHistory(user.userId, page, limit, filter);
  return sendSuccess(res, result.items, 200, {
    pagination: calculatePagination(result.total, page, limit),
  });
}

export async function activeBookingHandler(req: Request, res: Response) {
  const user = (req as any).user;
  const snapshot = await getPassengerActiveBooking(user.userId);
  return sendSuccess(res, snapshot);
}

export async function getBookingHandler(req: Request, res: Response) {
  const user = (req as any).user;
  const detail = await getBookingDetail(req.params.bookingId);
  if (!detail) return sendError(res, 'NOT_FOUND', 'Booking not found', 404);
  if (detail.booking.customerId !== user.userId) {
    return sendError(res, 'FORBIDDEN', 'Access denied', 403);
  }
  return sendSuccess(res, formatPassengerBookingSnapshot(detail));
}

export async function cancelBookingHandler(req: Request, res: Response) {
  try {
    const user = (req as any).user;
    const updated = await cancelBookingByCustomer(req.params.bookingId, user.userId, {
      reason: req.body?.reason,
      reasonCode: req.body?.reasonCode,
      idempotencyKey: req.header('Idempotency-Key') ?? undefined,
    });
    return sendSuccess(res, formatPassengerCancelResponse(updated));
  } catch (e) {
    if (e instanceof BookingCancellationError) {
      return sendError(res, e.code, e.message, e.statusCode);
    }
    return sendError(res, 'CANCEL_FAILED', e instanceof Error ? e.message : 'Cancel failed', 400);
  }
}

export async function consentRecordingHandler(req: Request, res: Response) {
  try {
    const user = (req as any).user;
    const updated = await consentRecording(
      req.params.bookingId,
      user.userId,
      req.body.consent,
      req.body.consentVersion
    );
    return sendSuccess(res, {
      bookingId: updated.id,
      consentStatus: updated.recordingConsentStatus,
      consentedAt: updated.recordingConsentedAt?.toISOString() ?? null,
      revokedAt: updated.recordingConsentRevokedAt?.toISOString() ?? null,
      consentVersion: updated.recordingConsentVersion,
    });
  } catch (e) {
    return sendError(res, 'CONSENT_FAILED', e instanceof Error ? e.message : 'Consent failed', 400);
  }
}

export async function shareBookingHandler(req: Request, res: Response) {
  const user = (req as any).user;
  const booking = await findBookingById(req.params.bookingId);
  if (!booking || booking.customerId !== user.userId) {
    return sendError(res, 'NOT_FOUND', 'Booking not found', 404);
  }
  return sendSuccess(res, {
    shareToken: booking.shareToken,
    shareUrl: `/api/v1/passenger/bookings/share/${booking.shareToken}`,
  });
}

export async function liveVideoHandler(req: Request, res: Response) {
  const user = (req as any).user;
  const booking = await findBookingById(req.params.bookingId);
  if (!booking || booking.customerId !== user.userId) {
    return sendError(res, 'NOT_FOUND', 'Booking not found', 404);
  }
  const data = await listLiveSegmentsByBooking(booking.id);
  return sendSuccess(res, data);
}

export async function nearbyDriversHandler(req: Request, res: Response) {
  const { lat, lng, serviceCategoryId, radiusKm } = req.query as any;
  const drivers = await findNearbyDriversForCategory(
    serviceCategoryId,
    Number(lat),
    Number(lng),
    radiusKm != null ? Number(radiusKm) : 15
  );

  const sanitized = drivers.slice(0, 20).map((d) => ({
    driverId: d.driverId,
    distanceKm: Math.round(d.distanceKm * 10) / 10,
    estimatedArrivalMinutes: estimateMinutesFromKm(d.distanceKm),
    vehicle: d.vehicleId
      ? {
          id: d.vehicleId,
          type: null,
          plateNumberMasked: maskPlateNumber(d.plateNumber),
        }
      : null,
  }));

  return sendSuccess(res, sanitized);
}
