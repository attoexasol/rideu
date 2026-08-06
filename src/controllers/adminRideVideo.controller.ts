import { Request, Response } from 'express';
import {
  createAdminPlaybackManifest,
  createAdminSegmentPlaybackUrl,
  getAdminBookingRideVideo,
  getAdminRideVideoHealth,
  getAdminRideVideoSession,
  getAdminRideVideoSummary,
  getAdminRideVideoTimeline,
  listAdminRideVideoAudit,
  listAdminRideVideoSegments,
  listAdminRideVideoSessions,
  requestAdminRideVideoDownload,
  type AdminActor,
  type ListRideVideoSessionsQuery,
} from '../services/adminRideVideo.service';
import { sendSuccess } from '../utils/response';

interface RequestUser {
  auth0Id?: string;
  email?: string;
  name?: string;
  userId?: string;
}

function actorFromReq(req: Request): AdminActor {
  const user = (req as Request & { user?: RequestUser }).user || {};
  return {
    auth0Id: user.auth0Id,
    email: user.email,
    name: user.name,
    userId: user.userId,
    ipAddress: req.ip,
    userAgent: req.get('user-agent') || undefined,
  };
}

export async function listRideVideosHandler(req: Request, res: Response) {
  const result = await listAdminRideVideoSessions(
    req.query as ListRideVideoSessionsQuery,
    actorFromReq(req)
  );
  return sendSuccess(res, { items: result.items }, 200, {
    pagination: result.pagination,
  });
}

export async function rideVideoSummaryHandler(req: Request, res: Response) {
  const data = await getAdminRideVideoSummary(
    req.query as Pick<
      ListRideVideoSessionsQuery,
      'dateFrom' | 'dateTo' | 'driverId' | 'passengerId'
    >,
    actorFromReq(req)
  );
  return sendSuccess(res, data);
}

export async function getRideVideoSessionHandler(req: Request, res: Response) {
  const data = await getAdminRideVideoSession(req.params.sessionId, actorFromReq(req));
  return sendSuccess(res, data);
}

export async function getBookingRideVideoHandler(req: Request, res: Response) {
  const data = await getAdminBookingRideVideo(req.params.bookingId, actorFromReq(req));
  return sendSuccess(res, data);
}

export async function listRideVideoSegmentsHandler(req: Request, res: Response) {
  const result = await listAdminRideVideoSegments(
    req.params.sessionId,
    req.query as { page?: number; limit?: number; sortOrder?: 'asc' | 'desc' },
    actorFromReq(req)
  );
  return sendSuccess(
    res,
    { items: result.items, missingSequences: result.missingSequences },
    200,
    { pagination: result.pagination }
  );
}

export async function rideVideoHealthHandler(req: Request, res: Response) {
  const data = await getAdminRideVideoHealth(req.params.sessionId, actorFromReq(req));
  return sendSuccess(res, data);
}

export async function rideVideoTimelineHandler(req: Request, res: Response) {
  const data = await getAdminRideVideoTimeline(req.params.sessionId, actorFromReq(req));
  return sendSuccess(res, data);
}

export async function rideVideoPlaybackManifestHandler(req: Request, res: Response) {
  const body = (req.body || {}) as {
    fromIndex?: number;
    fromSegmentIndex?: number;
    fromOffsetSeconds?: number;
    sinceManifestVersion?: number;
    limit?: number;
  };
  const query = req.query as typeof body;
  const data = await createAdminPlaybackManifest(
    req.params.sessionId,
    {
      fromIndex: body.fromIndex ?? query.fromIndex,
      fromSegmentIndex: body.fromSegmentIndex ?? query.fromSegmentIndex,
      fromOffsetSeconds: body.fromOffsetSeconds ?? query.fromOffsetSeconds,
      sinceManifestVersion: body.sinceManifestVersion ?? query.sinceManifestVersion,
      limit: body.limit ?? query.limit,
    },
    actorFromReq(req)
  );
  return sendSuccess(res, data);
}

export async function rideVideoSegmentPlaybackUrlHandler(req: Request, res: Response) {
  const data = await createAdminSegmentPlaybackUrl(
    req.params.sessionId,
    req.params.segmentId,
    actorFromReq(req)
  );
  return sendSuccess(res, data);
}

export async function rideVideoAuditHandler(req: Request, res: Response) {
  const result = await listAdminRideVideoAudit(
    req.params.sessionId,
    req.query as { page?: number; limit?: number },
    actorFromReq(req)
  );
  return sendSuccess(res, { items: result.items }, 200, {
    pagination: result.pagination,
  });
}

export async function rideVideoDownloadHandler(req: Request, res: Response) {
  await requestAdminRideVideoDownload(req.params.sessionId, actorFromReq(req));
  return res;
}
