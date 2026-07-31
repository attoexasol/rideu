import { Request, Response } from 'express';
import { sendSuccess, sendError } from '../utils/response';
import {
  assignDriverServiceCategory,
  removeDriverServiceCategory,
  listDriverServiceCategories,
  listCanonicalActiveServiceCategories,
  toPublicCategoryPayload,
} from '../repositories/serviceCategory.repository';

export async function listCategoriesHandler(_req: Request, res: Response) {
  const categories = await listCanonicalActiveServiceCategories();
  return sendSuccess(
    res,
    categories
      .filter((c) => c.code !== 'rental')
      .map((c) => toPublicCategoryPayload(c))
  );
}

export async function listDriverCategoriesHandler(req: Request, res: Response) {
  const rows = await listDriverServiceCategories(req.params.driverId);
  return sendSuccess(res, rows);
}

export async function assignCategoryHandler(req: Request, res: Response) {
  const { driverId, serviceCategoryId, isPrimary } = req.body;
  const row = await assignDriverServiceCategory(driverId, serviceCategoryId, isPrimary ?? false);
  if (!row) return sendError(res, 'DUPLICATE', 'Category already assigned', 409);
  return sendSuccess(res, row, 201);
}

export async function removeCategoryHandler(req: Request, res: Response) {
  await removeDriverServiceCategory(req.params.driverId, req.params.categoryId);
  return sendSuccess(res, { message: 'Removed' });
}
