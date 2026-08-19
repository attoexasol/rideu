import { z } from 'zod';

const phonePartsSchema = z
  .object({
    countryCode: z.string().trim().min(1, 'countryCode is required').max(10),
    number: z.string().trim().min(4, 'number is too short').max(30),
  })
  .strict();

export const profilePatchSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(255).optional(),
    phone: z.union([phonePartsSchema, z.null()]).optional(),
  })
  .strict();

export const profileDeactivateSchema = z
  .object({
    confirm: z.literal(true, {
      errorMap: () => ({ message: 'confirm must be true' }),
    }),
  })
  .strict();

export const adminPassengerIdParamSchema = z
  .object({
    id: z.string().uuid('Invalid passenger id'),
  })
  .strict();

export const adminPassengerListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  search: z.string().trim().max(255).optional(),
});

export type ProfilePatchInput = z.infer<typeof profilePatchSchema>;
export type ProfilePhoneInput = z.infer<typeof phonePartsSchema>;
