import { z } from 'zod';

export const CAB_FIELD_TYPES = ['cab_number', 'cab_licence'] as const;
export type CabFieldType = (typeof CAB_FIELD_TYPES)[number];

const cabValueString = z
  .string()
  .trim()
  .min(1, 'Cab number or licence is required')
  .max(100, 'Must be 100 characters or less');

export const cabFieldTypeSchema = z.enum(CAB_FIELD_TYPES, {
  errorMap: () => ({ message: 'fieldType must be cab_number or cab_licence' }),
});

export const optionalCabIdentifierFields = {
  cabFieldType: cabFieldTypeSchema.optional(),
  cabValue: z.preprocess(
    (val) => (val === '' || val === null || val === undefined ? undefined : String(val).trim()),
    z.string().min(1).max(100).optional()
  ),
  cabLicence: z.preprocess(
    (val) => (val === '' || val === null || val === undefined ? undefined : String(val).trim()),
    z.string().max(100, 'Cab licence must be 100 characters or less').optional()
  ),
};

export const cabIdentifierPairRefinement = (
  data: { cabFieldType?: CabFieldType; cabValue?: string },
  ctx: z.RefinementCtx
) => {
  const hasType = data.cabFieldType !== undefined;
  const hasValue = data.cabValue !== undefined;

  if (hasType && !hasValue) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'cabValue is required when cabFieldType is provided',
      path: ['cabValue'],
    });
  }

  if (hasValue && !hasType) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'cabFieldType is required when cabValue is provided',
      path: ['cabFieldType'],
    });
  }
};

export const updateCabIdentifierSchema = z.object({
  fieldType: cabFieldTypeSchema,
  value: cabValueString,
});

export function isCabFieldType(value: string): value is CabFieldType {
  return CAB_FIELD_TYPES.includes(value as CabFieldType);
}

/**
 * Accept common frontend payload shapes and normalize to cabFieldType + cabValue.
 */
export function normalizeFieldTypeAlias(type: string): CabFieldType | undefined {
  const normalized = type.trim().toLowerCase().replace(/\s+/g, '_');

  if (normalized === 'cab_number' || normalized === 'cabnumber') {
    return 'cab_number';
  }

  if (
    normalized === 'cab_licence' ||
    normalized === 'cablicence' ||
    normalized === 'cab_license' ||
    normalized === 'cablicense'
  ) {
    return 'cab_licence';
  }

  return isCabFieldType(type) ? type : undefined;
}

export interface CabIdentifierBody {
  cabFieldType?: unknown;
  cabValue?: unknown;
  cab_field_type?: unknown;
  cab_value?: unknown;
  fieldType?: unknown;
  value?: unknown;
  cabLicence?: unknown;
  cab_licence?: unknown;
  cabNumber?: unknown;
  cab_number?: unknown;
}

function toTrimmedString(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function normalizeCabIdentifierInput(body: CabIdentifierBody): {
  cabFieldType?: CabFieldType;
  cabValue?: string;
} {
  const rawType = toTrimmedString(body.cabFieldType ?? body.cab_field_type ?? body.fieldType);
  const rawValue = toTrimmedString(body.cabValue ?? body.cab_value ?? body.value);

  if (rawType && rawValue) {
    const fieldType = normalizeFieldTypeAlias(rawType);
    if (fieldType) {
      return { cabFieldType: fieldType, cabValue: rawValue };
    }
  }

  const licence = toTrimmedString(body.cabLicence ?? body.cab_licence);
  if (licence) {
    return { cabFieldType: 'cab_licence', cabValue: licence };
  }

  const number = toTrimmedString(body.cabNumber ?? body.cab_number);
  if (number) {
    return { cabFieldType: 'cab_number', cabValue: number };
  }

  return {};
}

/**
 * Resolve cab_number / cab_licence for INSERT — only the selected field is set.
 */
export function resolveCabFieldsForInsert(input: CabIdentifierBody): {
  cabNumber: string | null;
  cabLicence: string | null;
} {
  const normalized = normalizeCabIdentifierInput(input);

  if (normalized.cabFieldType && normalized.cabValue) {
    if (normalized.cabFieldType === 'cab_number') {
      return { cabNumber: normalized.cabValue, cabLicence: null };
    }
    return { cabNumber: null, cabLicence: normalized.cabValue };
  }

  return { cabNumber: null, cabLicence: null };
}

/**
 * Resolve cab fields for UPDATE — returns field to update via parameterized SQL, or null if none.
 */
export function resolveCabFieldsForUpdate(input: CabIdentifierBody): {
  cabFieldType?: CabFieldType;
  cabValue?: string;
} {
  return normalizeCabIdentifierInput(input);
}
