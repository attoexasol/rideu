import { Request, Response } from 'express';
import { sendError, sendSuccess } from '../utils/response';
import { driverUtils } from '../db/utils';
import type { DriverDocumentType } from '../config/driverDocuments';
import {
  DriverDocumentError,
  getAdminDriverDocument,
  getDocumentMetadataForDriver,
  listAdminDriverDocuments,
  listDocumentsForDriver,
  resolveDocumentFile,
  resolveSignedDriverDocumentFile,
  uploadOrReplaceDriverDocument,
} from '../services/driverDocument.service';
import { DriverDocumentStorageError } from '../services/driver-document-storage.service';

function handleDocumentError(res: Response, error: unknown): Response | void {
  if (error instanceof DriverDocumentError || error instanceof DriverDocumentStorageError) {
    return sendError(res, error.code, error.message, error.statusCode);
  }
  throw error;
}

async function resolveSelfDriver(req: Request) {
  const user = (req as any).user;
  return driverUtils.findByAuth0Id(user?.auth0Id ?? '');
}

function sendDocumentFile(
  res: Response,
  file: { absolutePath: string; mimeType: string; originalFilename: string }
) {
  res.setHeader('Content-Type', file.mimeType);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader(
    'Content-Disposition',
    `inline; filename="${file.originalFilename.replace(/"/g, '')}"`
  );
  return res.sendFile(file.absolutePath);
}

export async function listMyDocumentsHandler(req: Request, res: Response) {
  const driver = await resolveSelfDriver(req);
  if (!driver) return sendError(res, 'NOT_FOUND', 'Driver not found', 404);
  try {
    const documents = await listDocumentsForDriver(driver.id, 'driver');
    return sendSuccess(res, { documents });
  } catch (error) {
    return handleDocumentError(res, error);
  }
}

export async function getMyDocumentHandler(req: Request, res: Response) {
  const driver = await resolveSelfDriver(req);
  if (!driver) return sendError(res, 'NOT_FOUND', 'Driver not found', 404);
  try {
    const data = await getDocumentMetadataForDriver(
      driver.id,
      req.params.documentType as DriverDocumentType,
      'driver'
    );
    return sendSuccess(res, data);
  } catch (error) {
    return handleDocumentError(res, error);
  }
}

export async function uploadMyDocumentHandler(req: Request, res: Response) {
  const driver = await resolveSelfDriver(req);
  if (!driver) return sendError(res, 'NOT_FOUND', 'Driver not found', 404);
  if (!req.file?.buffer) {
    return sendError(res, 'VALIDATION_ERROR', 'file is required', 400);
  }
  try {
    const data = await uploadOrReplaceDriverDocument({
      driverId: driver.id,
      documentType: req.params.documentType as DriverDocumentType,
      buffer: req.file.buffer,
      declaredMime: req.file.mimetype,
      originalFilename: req.file.originalname,
    });
    return sendSuccess(res, data, 200);
  } catch (error) {
    return handleDocumentError(res, error);
  }
}

export async function downloadMyDocumentHandler(req: Request, res: Response) {
  const driver = await resolveSelfDriver(req);
  if (!driver) return sendError(res, 'NOT_FOUND', 'Driver not found', 404);
  try {
    const file = await resolveDocumentFile({
      driverId: driver.id,
      documentType: req.params.documentType as DriverDocumentType,
      token: typeof req.query.token === 'string' ? req.query.token : undefined,
    });
    return sendDocumentFile(res, file);
  } catch (error) {
    return handleDocumentError(res, error);
  }
}

export async function streamSignedOwnDriverDocumentHandler(req: Request, res: Response) {
  const token = typeof req.query.token === 'string' ? req.query.token : '';
  if (!token) {
    return sendError(res, 'INVALID_DOCUMENT_READ_AUTHORIZATION', 'Document read token is required', 403);
  }
  try {
    const file = await resolveSignedDriverDocumentFile({
      documentType: req.params.documentType as DriverDocumentType,
      token,
    });
    return sendDocumentFile(res, file);
  } catch (error) {
    return handleDocumentError(res, error);
  }
}

export async function streamSignedDriverDocumentHandler(req: Request, res: Response) {
  const token = typeof req.query.token === 'string' ? req.query.token : '';
  if (!token) {
    return sendError(res, 'INVALID_DOCUMENT_READ_AUTHORIZATION', 'Document read token is required', 403);
  }
  try {
    const file = await resolveDocumentFile({
      driverId: req.params.driverId,
      documentType: req.params.documentType as DriverDocumentType,
      token,
    });
    return sendDocumentFile(res, file);
  } catch (error) {
    return handleDocumentError(res, error);
  }
}

export async function adminListDriverDocumentsHandler(req: Request, res: Response) {
  try {
    const documents = await listAdminDriverDocuments(req.params.driverId);
    return sendSuccess(res, { driverId: req.params.driverId, documents });
  } catch (error) {
    return handleDocumentError(res, error);
  }
}

export async function adminGetDriverDocumentHandler(req: Request, res: Response) {
  try {
    const data = await getAdminDriverDocument(
      req.params.driverId,
      req.params.documentType as DriverDocumentType
    );
    return sendSuccess(res, data);
  } catch (error) {
    return handleDocumentError(res, error);
  }
}

export async function adminDownloadDriverDocumentHandler(req: Request, res: Response) {
  try {
    const file = await resolveDocumentFile({
      driverId: req.params.driverId,
      documentType: req.params.documentType as DriverDocumentType,
      token: typeof req.query.token === 'string' ? req.query.token : undefined,
    });
    return sendDocumentFile(res, file);
  } catch (error) {
    return handleDocumentError(res, error);
  }
}
