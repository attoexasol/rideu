import { Request, Response, NextFunction } from 'express';
import { normalizeCabIdentifierInput } from '../utils/cabIdentifier';

/**
 * Log request body and normalize cab identifier fields before validation/handlers.
 */
export function logAndNormalizeCabIdentifier(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  console.log('REQUEST BODY:', req.body);

  const normalized = normalizeCabIdentifierInput(req.body);
  if (normalized.cabFieldType && normalized.cabValue) {
    req.body.cabFieldType = normalized.cabFieldType;
    req.body.cabValue = normalized.cabValue;
    req.body.fieldType = normalized.cabFieldType;
    req.body.value = normalized.cabValue;
  }

  console.log('NORMALIZED CAB IDENTIFIER:', normalized);
  next();
}
