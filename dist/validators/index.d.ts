/**
 * Request Validation Schemas using Zod
 *
 * All API request validation schemas
 */
import { z } from 'zod';
import { updateCabIdentifierSchema } from '../utils/cabIdentifier';
export { updateCabIdentifierSchema };
export declare const loginSchema: z.ZodObject<{
    auth0Token: z.ZodString;
    deviceId: z.ZodOptional<z.ZodString>;
    deviceInfo: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    auth0Token: string;
    deviceId?: string | undefined;
    deviceInfo?: string | undefined;
}, {
    auth0Token: string;
    deviceId?: string | undefined;
    deviceInfo?: string | undefined;
}>;
export declare const refreshTokenSchema: z.ZodObject<{
    refreshToken: z.ZodString;
}, "strip", z.ZodTypeAny, {
    refreshToken: string;
}, {
    refreshToken: string;
}>;
export declare const createDriverSchema: z.ZodEffects<z.ZodEffects<z.ZodObject<{
    cabNumber: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
    vehicleMake: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
    vehicleModel: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
    vehicleYear: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
    vehicleColor: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
    cabFieldType: z.ZodOptional<z.ZodEnum<["cab_number", "cab_licence"]>>;
    cabValue: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
    cabLicence: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
    email: z.ZodString;
    password: z.ZodString;
    name: z.ZodString;
    phone: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
    vehicleType: z.ZodEffects<z.ZodOptional<z.ZodEnum<["sedan", "suv", "van", "mini_bus", "coach_bus"]>>, "sedan" | "suv" | "van" | "mini_bus" | "coach_bus" | undefined, unknown>;
    vehicleId: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
    cabName: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
}, "strip", z.ZodTypeAny, {
    name: string;
    email: string;
    password: string;
    phone?: string | undefined;
    vehicleType?: "sedan" | "suv" | "van" | "mini_bus" | "coach_bus" | undefined;
    vehicleId?: string | undefined;
    cabName?: string | undefined;
    cabNumber?: string | undefined;
    cabLicence?: string | undefined;
    vehicleMake?: string | undefined;
    vehicleModel?: string | undefined;
    vehicleYear?: string | undefined;
    vehicleColor?: string | undefined;
    cabValue?: string | undefined;
    cabFieldType?: "cab_number" | "cab_licence" | undefined;
}, {
    name: string;
    email: string;
    password: string;
    phone?: unknown;
    vehicleType?: unknown;
    vehicleId?: unknown;
    cabName?: unknown;
    cabNumber?: unknown;
    cabLicence?: unknown;
    vehicleMake?: unknown;
    vehicleModel?: unknown;
    vehicleYear?: unknown;
    vehicleColor?: unknown;
    cabValue?: unknown;
    cabFieldType?: "cab_number" | "cab_licence" | undefined;
}>, {
    name: string;
    email: string;
    password: string;
    phone?: string | undefined;
    vehicleType?: "sedan" | "suv" | "van" | "mini_bus" | "coach_bus" | undefined;
    vehicleId?: string | undefined;
    cabName?: string | undefined;
    cabNumber?: string | undefined;
    cabLicence?: string | undefined;
    vehicleMake?: string | undefined;
    vehicleModel?: string | undefined;
    vehicleYear?: string | undefined;
    vehicleColor?: string | undefined;
    cabValue?: string | undefined;
    cabFieldType?: "cab_number" | "cab_licence" | undefined;
}, {
    name: string;
    email: string;
    password: string;
    phone?: unknown;
    vehicleType?: unknown;
    vehicleId?: unknown;
    cabName?: unknown;
    cabNumber?: unknown;
    cabLicence?: unknown;
    vehicleMake?: unknown;
    vehicleModel?: unknown;
    vehicleYear?: unknown;
    vehicleColor?: unknown;
    cabValue?: unknown;
    cabFieldType?: "cab_number" | "cab_licence" | undefined;
}>, {
    name: string;
    email: string;
    password: string;
    phone?: string | undefined;
    vehicleType?: "sedan" | "suv" | "van" | "mini_bus" | "coach_bus" | undefined;
    vehicleId?: string | undefined;
    cabName?: string | undefined;
    cabNumber?: string | undefined;
    cabLicence?: string | undefined;
    vehicleMake?: string | undefined;
    vehicleModel?: string | undefined;
    vehicleYear?: string | undefined;
    vehicleColor?: string | undefined;
    cabValue?: string | undefined;
    cabFieldType?: "cab_number" | "cab_licence" | undefined;
}, {
    name: string;
    email: string;
    password: string;
    phone?: unknown;
    vehicleType?: unknown;
    vehicleId?: unknown;
    cabName?: unknown;
    cabNumber?: unknown;
    cabLicence?: unknown;
    vehicleMake?: unknown;
    vehicleModel?: unknown;
    vehicleYear?: unknown;
    vehicleColor?: unknown;
    cabValue?: unknown;
    cabFieldType?: "cab_number" | "cab_licence" | undefined;
}>;
export declare const updateDriverSchema: z.ZodEffects<z.ZodEffects<z.ZodObject<{
    vehicleMake: z.ZodEffects<z.ZodNullable<z.ZodOptional<z.ZodString>>, string | null | undefined, unknown>;
    vehicleModel: z.ZodEffects<z.ZodNullable<z.ZodOptional<z.ZodString>>, string | null | undefined, unknown>;
    vehicleYear: z.ZodEffects<z.ZodNullable<z.ZodOptional<z.ZodString>>, string | null | undefined, unknown>;
    vehicleColor: z.ZodEffects<z.ZodNullable<z.ZodOptional<z.ZodString>>, string | null | undefined, unknown>;
    status: z.ZodOptional<z.ZodEnum<["online", "offline"]>>;
    cabFieldType: z.ZodOptional<z.ZodEnum<["cab_number", "cab_licence"]>>;
    cabValue: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
    cabLicence: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
    name: z.ZodOptional<z.ZodString>;
    phone: z.ZodEffects<z.ZodNullable<z.ZodOptional<z.ZodString>>, string | null | undefined, unknown>;
    vehicleType: z.ZodEffects<z.ZodNullable<z.ZodOptional<z.ZodEnum<["sedan", "suv", "van", "mini_bus", "coach_bus"]>>>, "sedan" | "suv" | "van" | "mini_bus" | "coach_bus" | null | undefined, unknown>;
    vehicleId: z.ZodEffects<z.ZodNullable<z.ZodOptional<z.ZodString>>, string | null | undefined, unknown>;
    cabName: z.ZodEffects<z.ZodNullable<z.ZodOptional<z.ZodString>>, string | null | undefined, unknown>;
}, "strip", z.ZodTypeAny, {
    name?: string | undefined;
    status?: "online" | "offline" | undefined;
    phone?: string | null | undefined;
    vehicleType?: "sedan" | "suv" | "van" | "mini_bus" | "coach_bus" | null | undefined;
    vehicleId?: string | null | undefined;
    cabName?: string | null | undefined;
    cabLicence?: string | undefined;
    vehicleMake?: string | null | undefined;
    vehicleModel?: string | null | undefined;
    vehicleYear?: string | null | undefined;
    vehicleColor?: string | null | undefined;
    cabValue?: string | undefined;
    cabFieldType?: "cab_number" | "cab_licence" | undefined;
}, {
    name?: string | undefined;
    status?: "online" | "offline" | undefined;
    phone?: unknown;
    vehicleType?: unknown;
    vehicleId?: unknown;
    cabName?: unknown;
    cabLicence?: unknown;
    vehicleMake?: unknown;
    vehicleModel?: unknown;
    vehicleYear?: unknown;
    vehicleColor?: unknown;
    cabValue?: unknown;
    cabFieldType?: "cab_number" | "cab_licence" | undefined;
}>, {
    name?: string | undefined;
    status?: "online" | "offline" | undefined;
    phone?: string | null | undefined;
    vehicleType?: "sedan" | "suv" | "van" | "mini_bus" | "coach_bus" | null | undefined;
    vehicleId?: string | null | undefined;
    cabName?: string | null | undefined;
    cabLicence?: string | undefined;
    vehicleMake?: string | null | undefined;
    vehicleModel?: string | null | undefined;
    vehicleYear?: string | null | undefined;
    vehicleColor?: string | null | undefined;
    cabValue?: string | undefined;
    cabFieldType?: "cab_number" | "cab_licence" | undefined;
}, {
    name?: string | undefined;
    status?: "online" | "offline" | undefined;
    phone?: unknown;
    vehicleType?: unknown;
    vehicleId?: unknown;
    cabName?: unknown;
    cabLicence?: unknown;
    vehicleMake?: unknown;
    vehicleModel?: unknown;
    vehicleYear?: unknown;
    vehicleColor?: unknown;
    cabValue?: unknown;
    cabFieldType?: "cab_number" | "cab_licence" | undefined;
}>, {
    name?: string | undefined;
    status?: "online" | "offline" | undefined;
    phone?: string | null | undefined;
    vehicleType?: "sedan" | "suv" | "van" | "mini_bus" | "coach_bus" | null | undefined;
    vehicleId?: string | null | undefined;
    cabName?: string | null | undefined;
    cabLicence?: string | undefined;
    vehicleMake?: string | null | undefined;
    vehicleModel?: string | null | undefined;
    vehicleYear?: string | null | undefined;
    vehicleColor?: string | null | undefined;
    cabValue?: string | undefined;
    cabFieldType?: "cab_number" | "cab_licence" | undefined;
}, {
    name?: string | undefined;
    status?: "online" | "offline" | undefined;
    phone?: unknown;
    vehicleType?: unknown;
    vehicleId?: unknown;
    cabName?: unknown;
    cabLicence?: unknown;
    vehicleMake?: unknown;
    vehicleModel?: unknown;
    vehicleYear?: unknown;
    vehicleColor?: unknown;
    cabValue?: unknown;
    cabFieldType?: "cab_number" | "cab_licence" | undefined;
}>;
export declare const updateDriverStatusSchema: z.ZodObject<{
    status: z.ZodEnum<["online", "offline"]>;
}, "strip", z.ZodTypeAny, {
    status: "online" | "offline";
}, {
    status: "online" | "offline";
}>;
export declare const getDriversQuerySchema: z.ZodObject<{
    status: z.ZodOptional<z.ZodEnum<["online", "offline"]>>;
    vehicleType: z.ZodOptional<z.ZodEnum<["sedan", "suv", "van", "mini_bus", "coach_bus"]>>;
    search: z.ZodOptional<z.ZodString>;
    page: z.ZodDefault<z.ZodOptional<z.ZodEffects<z.ZodString, number, string>>>;
    limit: z.ZodDefault<z.ZodOptional<z.ZodEffects<z.ZodString, number, string>>>;
}, "strip", z.ZodTypeAny, {
    limit: number;
    page: number;
    status?: "online" | "offline" | undefined;
    search?: string | undefined;
    vehicleType?: "sedan" | "suv" | "van" | "mini_bus" | "coach_bus" | undefined;
}, {
    limit?: string | undefined;
    status?: "online" | "offline" | undefined;
    search?: string | undefined;
    vehicleType?: "sedan" | "suv" | "van" | "mini_bus" | "coach_bus" | undefined;
    page?: string | undefined;
}>;
export declare const driverQrCodeParamSchema: z.ZodObject<{
    qrCode: z.ZodString;
}, "strip", z.ZodTypeAny, {
    qrCode: string;
}, {
    qrCode: string;
}>;
export declare const driverQrImageQuerySchema: z.ZodObject<{
    format: z.ZodDefault<z.ZodOptional<z.ZodEnum<["png", "base64"]>>>;
}, "strip", z.ZodTypeAny, {
    format: "base64" | "png";
}, {
    format?: "base64" | "png" | undefined;
}>;
export declare const driverIdParamSchema: z.ZodObject<{
    id: z.ZodString;
}, "strip", z.ZodTypeAny, {
    id: string;
}, {
    id: string;
}>;
export declare const vehicleIdParamSchema: z.ZodObject<{
    vehicleId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    vehicleId: string;
}, {
    vehicleId: string;
}>;
export declare const vehicleQrCodeParamSchema: z.ZodObject<{
    qrCode: z.ZodString;
}, "strip", z.ZodTypeAny, {
    qrCode: string;
}, {
    qrCode: string;
}>;
export declare const vehicleQrImageQuerySchema: z.ZodObject<{
    format: z.ZodDefault<z.ZodOptional<z.ZodEnum<["png", "base64"]>>>;
}, "strip", z.ZodTypeAny, {
    format: "base64" | "png";
}, {
    format?: "base64" | "png" | undefined;
}>;
export declare const vehicleScanSchema: z.ZodObject<{
    qrCode: z.ZodString;
}, "strip", z.ZodTypeAny, {
    qrCode: string;
}, {
    qrCode: string;
}>;
export declare const companyCheckInQrQuerySchema: z.ZodObject<{
    format: z.ZodDefault<z.ZodOptional<z.ZodEnum<["png", "base64"]>>>;
}, "strip", z.ZodTypeAny, {
    format: "base64" | "png";
}, {
    format?: "base64" | "png" | undefined;
}>;
export declare const createVehicleSchema: z.ZodObject<{
    make: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
    model: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
    year: z.ZodEffects<z.ZodOptional<z.ZodNumber>, number | undefined, unknown>;
    plateNumber: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
    vin: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
    bodyNumber: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
    status: z.ZodDefault<z.ZodOptional<z.ZodEnum<["active", "inactive", "maintenance"]>>>;
}, "strip", z.ZodTypeAny, {
    status: "active" | "inactive" | "maintenance";
    make?: string | undefined;
    model?: string | undefined;
    year?: number | undefined;
    plateNumber?: string | undefined;
    vin?: string | undefined;
    bodyNumber?: string | undefined;
}, {
    status?: "active" | "inactive" | "maintenance" | undefined;
    make?: unknown;
    model?: unknown;
    year?: unknown;
    plateNumber?: unknown;
    vin?: unknown;
    bodyNumber?: unknown;
}>;
export declare const scanVehicleSchema: z.ZodObject<{
    driverId: z.ZodString;
    vehicleQrCode: z.ZodString;
}, "strip", z.ZodTypeAny, {
    vehicleQrCode: string;
    driverId: string;
}, {
    vehicleQrCode: string;
    driverId: string;
}>;
export declare const checkInSchema: z.ZodObject<{
    driverId: z.ZodString;
    qrCode: z.ZodLiteral<"COMPANY_CHECKIN">;
    location: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
}, "strip", z.ZodTypeAny, {
    qrCode: "COMPANY_CHECKIN";
    driverId: string;
    location?: string | undefined;
}, {
    qrCode: "COMPANY_CHECKIN";
    driverId: string;
    location?: unknown;
}>;
export declare const checkOutSchema: z.ZodObject<{
    driverId: z.ZodString;
    qrCode: z.ZodLiteral<"COMPANY_CHECKIN">;
}, "strip", z.ZodTypeAny, {
    qrCode: "COMPANY_CHECKIN";
    driverId: string;
}, {
    qrCode: "COMPANY_CHECKIN";
    driverId: string;
}>;
export declare const driverIdPathSchema: z.ZodObject<{
    driverId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    driverId: string;
}, {
    driverId: string;
}>;
export declare const dutyLocationSchema: z.ZodOptional<z.ZodObject<{
    latitude: z.ZodNumber;
    longitude: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    latitude: number;
    longitude: number;
}, {
    latitude: number;
    longitude: number;
}>>;
export declare const dutyStartSchema: z.ZodObject<{
    vehicleQrToken: z.ZodString;
    location: z.ZodOptional<z.ZodObject<{
        latitude: z.ZodNumber;
        longitude: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        latitude: number;
        longitude: number;
    }, {
        latitude: number;
        longitude: number;
    }>>;
    deviceId: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    vehicleQrToken: string;
    location?: {
        latitude: number;
        longitude: number;
    } | undefined;
    deviceId?: string | undefined;
}, {
    vehicleQrToken: string;
    location?: {
        latitude: number;
        longitude: number;
    } | undefined;
    deviceId?: string | undefined;
}>;
export declare const dutyEndSchema: z.ZodObject<{
    reason: z.ZodOptional<z.ZodString>;
    location: z.ZodOptional<z.ZodObject<{
        latitude: z.ZodNumber;
        longitude: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        latitude: number;
        longitude: number;
    }, {
        latitude: number;
        longitude: number;
    }>>;
}, "strip", z.ZodTypeAny, {
    location?: {
        latitude: number;
        longitude: number;
    } | undefined;
    reason?: string | undefined;
}, {
    location?: {
        latitude: number;
        longitude: number;
    } | undefined;
    reason?: string | undefined;
}>;
export declare const fleetIdParamSchema: z.ZodObject<{
    fleetId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    fleetId: string;
}, {
    fleetId: string;
}>;
export declare const listAdminFleetVehiclesQuerySchema: z.ZodObject<{
    page: z.ZodOptional<z.ZodNumber>;
    limit: z.ZodOptional<z.ZodNumber>;
    search: z.ZodOptional<z.ZodString>;
    fleetId: z.ZodOptional<z.ZodString>;
    organizationId: z.ZodOptional<z.ZodString>;
    status: z.ZodOptional<z.ZodString>;
    serviceCategoryId: z.ZodOptional<z.ZodString>;
    qrStatus: z.ZodOptional<z.ZodEnum<["active", "none", "revoked"]>>;
    dutyStatus: z.ZodOptional<z.ZodEnum<["on_duty", "off_duty"]>>;
}, "strip", z.ZodTypeAny, {
    limit?: number | undefined;
    status?: string | undefined;
    search?: string | undefined;
    organizationId?: string | undefined;
    fleetId?: string | undefined;
    serviceCategoryId?: string | undefined;
    page?: number | undefined;
    qrStatus?: "active" | "revoked" | "none" | undefined;
    dutyStatus?: "on_duty" | "off_duty" | undefined;
}, {
    limit?: number | undefined;
    status?: string | undefined;
    search?: string | undefined;
    organizationId?: string | undefined;
    fleetId?: string | undefined;
    serviceCategoryId?: string | undefined;
    page?: number | undefined;
    qrStatus?: "active" | "revoked" | "none" | undefined;
    dutyStatus?: "on_duty" | "off_duty" | undefined;
}>;
export declare const patchAdminFleetVehicleSchema: z.ZodEffects<z.ZodObject<{
    make: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
    model: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
    year: z.ZodEffects<z.ZodOptional<z.ZodNumber>, number | undefined, unknown>;
    color: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
    plateNumber: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
    capacity: z.ZodEffects<z.ZodOptional<z.ZodNumber>, number | undefined, unknown>;
    fleetId: z.ZodOptional<z.ZodString>;
    status: z.ZodOptional<z.ZodEnum<["active", "inactive", "maintenance", "approved", "pending", "rejected"]>>;
    approvalStatus: z.ZodOptional<z.ZodEnum<["approved", "pending", "rejected"]>>;
    serviceCategoryIds: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
}, "strip", z.ZodTypeAny, {
    status?: "active" | "pending" | "rejected" | "approved" | "inactive" | "maintenance" | undefined;
    make?: string | undefined;
    model?: string | undefined;
    year?: number | undefined;
    color?: string | undefined;
    plateNumber?: string | undefined;
    fleetId?: string | undefined;
    capacity?: number | undefined;
    approvalStatus?: "pending" | "rejected" | "approved" | undefined;
    serviceCategoryIds?: string[] | undefined;
}, {
    status?: "active" | "pending" | "rejected" | "approved" | "inactive" | "maintenance" | undefined;
    make?: unknown;
    model?: unknown;
    year?: unknown;
    color?: unknown;
    plateNumber?: unknown;
    fleetId?: string | undefined;
    capacity?: unknown;
    approvalStatus?: "pending" | "rejected" | "approved" | undefined;
    serviceCategoryIds?: string[] | undefined;
}>, {
    status?: "active" | "pending" | "rejected" | "approved" | "inactive" | "maintenance" | undefined;
    make?: string | undefined;
    model?: string | undefined;
    year?: number | undefined;
    color?: string | undefined;
    plateNumber?: string | undefined;
    fleetId?: string | undefined;
    capacity?: number | undefined;
    approvalStatus?: "pending" | "rejected" | "approved" | undefined;
    serviceCategoryIds?: string[] | undefined;
}, {
    status?: "active" | "pending" | "rejected" | "approved" | "inactive" | "maintenance" | undefined;
    make?: unknown;
    model?: unknown;
    year?: unknown;
    color?: unknown;
    plateNumber?: unknown;
    fleetId?: string | undefined;
    capacity?: unknown;
    approvalStatus?: "pending" | "rejected" | "approved" | undefined;
    serviceCategoryIds?: string[] | undefined;
}>;
export declare const vehicleQrTokenIdParamSchema: z.ZodObject<{
    tokenId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    tokenId: string;
}, {
    tokenId: string;
}>;
export declare const assignDriverFleetSchema: z.ZodObject<{
    fleetId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    fleetId: string;
}, {
    fleetId: string;
}>;
export declare const forceEndDutySchema: z.ZodObject<{
    reason: z.ZodOptional<z.ZodString>;
    location: z.ZodOptional<z.ZodObject<{
        latitude: z.ZodNumber;
        longitude: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        latitude: number;
        longitude: number;
    }, {
        latitude: number;
        longitude: number;
    }>>;
    emergency: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    location?: {
        latitude: number;
        longitude: number;
    } | undefined;
    reason?: string | undefined;
    emergency?: boolean | undefined;
}, {
    location?: {
        latitude: number;
        longitude: number;
    } | undefined;
    reason?: string | undefined;
    emergency?: boolean | undefined;
}>;
export declare const exchangeIdParamSchema: z.ZodObject<{
    exchangeId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    exchangeId: string;
}, {
    exchangeId: string;
}>;
export declare const initiateExchangeSchema: z.ZodObject<{
    scannedVehicleQrToken: z.ZodString;
    location: z.ZodOptional<z.ZodObject<{
        latitude: z.ZodNumber;
        longitude: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        latitude: number;
        longitude: number;
    }, {
        latitude: number;
        longitude: number;
    }>>;
}, "strip", z.ZodTypeAny, {
    scannedVehicleQrToken: string;
    location?: {
        latitude: number;
        longitude: number;
    } | undefined;
}, {
    scannedVehicleQrToken: string;
    location?: {
        latitude: number;
        longitude: number;
    } | undefined;
}>;
export declare const confirmExchangeSchema: z.ZodObject<{
    scannedVehicleQrToken: z.ZodString;
    location: z.ZodOptional<z.ZodObject<{
        latitude: z.ZodNumber;
        longitude: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        latitude: number;
        longitude: number;
    }, {
        latitude: number;
        longitude: number;
    }>>;
}, "strip", z.ZodTypeAny, {
    scannedVehicleQrToken: string;
    location?: {
        latitude: number;
        longitude: number;
    } | undefined;
}, {
    scannedVehicleQrToken: string;
    location?: {
        latitude: number;
        longitude: number;
    } | undefined;
}>;
export declare const cancelExchangeSchema: z.ZodObject<{
    reason: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    reason?: string | undefined;
}, {
    reason?: string | undefined;
}>;
export declare const submitLocationSchema: z.ZodObject<{
    latitude: z.ZodNumber;
    longitude: z.ZodNumber;
    accuracy: z.ZodOptional<z.ZodNumber>;
    speed: z.ZodOptional<z.ZodNumber>;
    heading: z.ZodOptional<z.ZodNumber>;
    timestamp: z.ZodString;
    bookingId: z.ZodNullable<z.ZodOptional<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    latitude: number;
    longitude: number;
    timestamp: string;
    bookingId?: string | null | undefined;
    accuracy?: number | undefined;
    speed?: number | undefined;
    heading?: number | undefined;
}, {
    latitude: number;
    longitude: number;
    timestamp: string;
    bookingId?: string | null | undefined;
    accuracy?: number | undefined;
    speed?: number | undefined;
    heading?: number | undefined;
}>;
export declare const getLocationsQuerySchema: z.ZodObject<{
    startDate: z.ZodOptional<z.ZodString>;
    endDate: z.ZodOptional<z.ZodString>;
    limit: z.ZodDefault<z.ZodOptional<z.ZodEffects<z.ZodString, number, string>>>;
}, "strip", z.ZodTypeAny, {
    limit: number;
    startDate?: string | undefined;
    endDate?: string | undefined;
}, {
    limit?: string | undefined;
    startDate?: string | undefined;
    endDate?: string | undefined;
}>;
export declare const createTripSchema: z.ZodObject<{
    startTime: z.ZodString;
    startLocationId: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    startTime: string;
    startLocationId?: string | undefined;
}, {
    startTime: string;
    startLocationId?: string | undefined;
}>;
export declare const updateTripSchema: z.ZodObject<{
    endTime: z.ZodOptional<z.ZodString>;
    endLocationId: z.ZodOptional<z.ZodString>;
    distance: z.ZodOptional<z.ZodNumber>;
    status: z.ZodOptional<z.ZodEnum<["in_progress", "completed", "cancelled"]>>;
}, "strip", z.ZodTypeAny, {
    status?: "in_progress" | "completed" | "cancelled" | undefined;
    endTime?: string | undefined;
    distance?: number | undefined;
    endLocationId?: string | undefined;
}, {
    status?: "in_progress" | "completed" | "cancelled" | undefined;
    endTime?: string | undefined;
    distance?: number | undefined;
    endLocationId?: string | undefined;
}>;
export declare const getTripsQuerySchema: z.ZodObject<{
    startDate: z.ZodOptional<z.ZodString>;
    endDate: z.ZodOptional<z.ZodString>;
    status: z.ZodOptional<z.ZodEnum<["in_progress", "completed", "cancelled"]>>;
    page: z.ZodDefault<z.ZodOptional<z.ZodEffects<z.ZodString, number, string>>>;
    limit: z.ZodDefault<z.ZodOptional<z.ZodEffects<z.ZodString, number, string>>>;
}, "strip", z.ZodTypeAny, {
    limit: number;
    page: number;
    status?: "in_progress" | "completed" | "cancelled" | undefined;
    startDate?: string | undefined;
    endDate?: string | undefined;
}, {
    limit?: string | undefined;
    status?: "in_progress" | "completed" | "cancelled" | undefined;
    page?: string | undefined;
    startDate?: string | undefined;
    endDate?: string | undefined;
}>;
export declare const tripIdParamSchema: z.ZodObject<{
    tripId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    tripId: string;
}, {
    tripId: string;
}>;
export declare const tripQrImageQuerySchema: z.ZodObject<{
    format: z.ZodDefault<z.ZodOptional<z.ZodEnum<["png", "base64"]>>>;
}, "strip", z.ZodTypeAny, {
    format: "base64" | "png";
}, {
    format?: "base64" | "png" | undefined;
}>;
export declare const scanPassengerSchema: z.ZodObject<{
    driverId: z.ZodString;
    qrCode: z.ZodString;
}, "strip", z.ZodTypeAny, {
    qrCode: string;
    driverId: string;
}, {
    qrCode: string;
    driverId: string;
}>;
export declare const videoUploadBodySchema: z.ZodObject<{
    tripId: z.ZodString;
    startTime: z.ZodString;
    endTime: z.ZodString;
    duration: z.ZodEffects<z.ZodNumber, number, unknown>;
}, "strip", z.ZodTypeAny, {
    duration: number;
    startTime: string;
    endTime: string;
    tripId: string;
}, {
    startTime: string;
    endTime: string;
    tripId: string;
    duration?: unknown;
}>;
export declare const videoIdParamSchema: z.ZodObject<{
    videoId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    videoId: string;
}, {
    videoId: string;
}>;
export declare const exportReportQuerySchema: z.ZodObject<{
    type: z.ZodEnum<["csv", "pdf"]>;
    reportType: z.ZodEnum<["drivers", "trips", "locations"]>;
    startDate: z.ZodOptional<z.ZodString>;
    endDate: z.ZodOptional<z.ZodString>;
    driverId: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    type: "csv" | "pdf";
    reportType: "drivers" | "locations" | "trips";
    driverId?: string | undefined;
    startDate?: string | undefined;
    endDate?: string | undefined;
}, {
    type: "csv" | "pdf";
    reportType: "drivers" | "locations" | "trips";
    driverId?: string | undefined;
    startDate?: string | undefined;
    endDate?: string | undefined;
}>;
export declare const getReportQuerySchema: z.ZodObject<{
    startDate: z.ZodOptional<z.ZodString>;
    endDate: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    startDate?: string | undefined;
    endDate?: string | undefined;
}, {
    startDate?: string | undefined;
    endDate?: string | undefined;
}>;
export declare const createAdminUserSchema: z.ZodObject<{
    email: z.ZodString;
    name: z.ZodString;
    role: z.ZodEnum<["admin", "super_admin"]>;
}, "strip", z.ZodTypeAny, {
    name: string;
    email: string;
    role: "admin" | "super_admin";
}, {
    name: string;
    email: string;
    role: "admin" | "super_admin";
}>;
export declare const updateAdminUserSchema: z.ZodObject<{
    name: z.ZodOptional<z.ZodString>;
    role: z.ZodOptional<z.ZodEnum<["admin", "super_admin"]>>;
}, "strip", z.ZodTypeAny, {
    name?: string | undefined;
    role?: "admin" | "super_admin" | undefined;
}, {
    name?: string | undefined;
    role?: "admin" | "super_admin" | undefined;
}>;
export declare const passengerRegisterSchema: z.ZodObject<{
    email: z.ZodEffects<z.ZodString, string, string>;
    password: z.ZodString;
    name: z.ZodString;
}, "strip", z.ZodTypeAny, {
    name: string;
    email: string;
    password: string;
}, {
    name: string;
    email: string;
    password: string;
}>;
export declare const passengerLoginSchema: z.ZodObject<{
    auth0Token: z.ZodString;
    deviceId: z.ZodOptional<z.ZodString>;
    deviceInfo: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    auth0Token: string;
    deviceId?: string | undefined;
    deviceInfo?: string | undefined;
}, {
    auth0Token: string;
    deviceId?: string | undefined;
    deviceInfo?: string | undefined;
}>;
export declare const passengerForgotPasswordSchema: z.ZodObject<{
    email: z.ZodEffects<z.ZodString, string, string>;
}, "strip", z.ZodTypeAny, {
    email: string;
}, {
    email: string;
}>;
export declare const latitudeSchema: z.ZodNumber;
export declare const longitudeSchema: z.ZodNumber;
export declare const latitudeQuerySchema: z.ZodNumber;
export declare const longitudeQuerySchema: z.ZodNumber;
export declare const bookingQuoteSchema: z.ZodObject<{
    serviceCategoryId: z.ZodOptional<z.ZodString>;
    pickup: z.ZodObject<{
        latitude: z.ZodNumber;
        longitude: z.ZodNumber;
    } & {
        address: z.ZodOptional<z.ZodString>;
        spotLabel: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
    }, "strip", z.ZodTypeAny, {
        latitude: number;
        longitude: number;
        address?: string | undefined;
        spotLabel?: string | undefined;
    }, {
        latitude: number;
        longitude: number;
        address?: string | undefined;
        spotLabel?: unknown;
    }>;
    dropoff: z.ZodObject<{
        latitude: z.ZodNumber;
        longitude: z.ZodNumber;
    } & {
        address: z.ZodOptional<z.ZodString>;
        placeId: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
    }, "strip", z.ZodTypeAny, {
        latitude: number;
        longitude: number;
        address?: string | undefined;
        placeId?: string | undefined;
    }, {
        latitude: number;
        longitude: number;
        address?: string | undefined;
        placeId?: unknown;
    }>;
    stops: z.ZodDefault<z.ZodOptional<z.ZodArray<z.ZodObject<{
        latitude: z.ZodNumber;
        longitude: z.ZodNumber;
    } & {
        address: z.ZodString;
        placeId: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
    }, "strip", z.ZodTypeAny, {
        latitude: number;
        longitude: number;
        address: string;
        placeId?: string | undefined;
    }, {
        latitude: number;
        longitude: number;
        address: string;
        placeId?: unknown;
    }>, "many">>>;
}, "strip", z.ZodTypeAny, {
    pickup: {
        latitude: number;
        longitude: number;
        address?: string | undefined;
        spotLabel?: string | undefined;
    };
    dropoff: {
        latitude: number;
        longitude: number;
        address?: string | undefined;
        placeId?: string | undefined;
    };
    stops: {
        latitude: number;
        longitude: number;
        address: string;
        placeId?: string | undefined;
    }[];
    serviceCategoryId?: string | undefined;
}, {
    pickup: {
        latitude: number;
        longitude: number;
        address?: string | undefined;
        spotLabel?: unknown;
    };
    dropoff: {
        latitude: number;
        longitude: number;
        address?: string | undefined;
        placeId?: unknown;
    };
    serviceCategoryId?: string | undefined;
    stops?: {
        latitude: number;
        longitude: number;
        address: string;
        placeId?: unknown;
    }[] | undefined;
}>;
export declare const createBookingSchema: z.ZodEffects<z.ZodObject<{
    serviceCategoryId: z.ZodString;
    pickup: z.ZodObject<{
        latitude: z.ZodNumber;
        longitude: z.ZodNumber;
    } & {
        address: z.ZodString;
        spotLabel: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
    }, "strip", z.ZodTypeAny, {
        latitude: number;
        longitude: number;
        address: string;
        spotLabel?: string | undefined;
    }, {
        latitude: number;
        longitude: number;
        address: string;
        spotLabel?: unknown;
    }>;
    dropoff: z.ZodObject<{
        latitude: z.ZodNumber;
        longitude: z.ZodNumber;
    } & {
        address: z.ZodString;
        placeId: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
    }, "strip", z.ZodTypeAny, {
        latitude: number;
        longitude: number;
        address: string;
        placeId?: string | undefined;
    }, {
        latitude: number;
        longitude: number;
        address: string;
        placeId?: unknown;
    }>;
    stops: z.ZodDefault<z.ZodOptional<z.ZodArray<z.ZodObject<{
        latitude: z.ZodNumber;
        longitude: z.ZodNumber;
    } & {
        address: z.ZodString;
        placeId: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
    }, "strip", z.ZodTypeAny, {
        latitude: number;
        longitude: number;
        address: string;
        placeId?: string | undefined;
    }, {
        latitude: number;
        longitude: number;
        address: string;
        placeId?: unknown;
    }>, "many">>>;
    paymentMethodCode: z.ZodEffects<z.ZodDefault<z.ZodString>, string, unknown>;
    schedulingType: z.ZodDefault<z.ZodOptional<z.ZodEnum<["instant", "scheduled"]>>>;
    scheduledPickupAt: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    serviceCategoryId: string;
    schedulingType: "instant" | "scheduled";
    pickup: {
        latitude: number;
        longitude: number;
        address: string;
        spotLabel?: string | undefined;
    };
    dropoff: {
        latitude: number;
        longitude: number;
        address: string;
        placeId?: string | undefined;
    };
    stops: {
        latitude: number;
        longitude: number;
        address: string;
        placeId?: string | undefined;
    }[];
    paymentMethodCode: string;
    scheduledPickupAt?: string | undefined;
}, {
    serviceCategoryId: string;
    pickup: {
        latitude: number;
        longitude: number;
        address: string;
        spotLabel?: unknown;
    };
    dropoff: {
        latitude: number;
        longitude: number;
        address: string;
        placeId?: unknown;
    };
    schedulingType?: "instant" | "scheduled" | undefined;
    scheduledPickupAt?: string | undefined;
    stops?: {
        latitude: number;
        longitude: number;
        address: string;
        placeId?: unknown;
    }[] | undefined;
    paymentMethodCode?: unknown;
}>, {
    serviceCategoryId: string;
    schedulingType: "instant" | "scheduled";
    pickup: {
        latitude: number;
        longitude: number;
        address: string;
        spotLabel?: string | undefined;
    };
    dropoff: {
        latitude: number;
        longitude: number;
        address: string;
        placeId?: string | undefined;
    };
    stops: {
        latitude: number;
        longitude: number;
        address: string;
        placeId?: string | undefined;
    }[];
    paymentMethodCode: string;
    scheduledPickupAt?: string | undefined;
}, {
    serviceCategoryId: string;
    pickup: {
        latitude: number;
        longitude: number;
        address: string;
        spotLabel?: unknown;
    };
    dropoff: {
        latitude: number;
        longitude: number;
        address: string;
        placeId?: unknown;
    };
    schedulingType?: "instant" | "scheduled" | undefined;
    scheduledPickupAt?: string | undefined;
    stops?: {
        latitude: number;
        longitude: number;
        address: string;
        placeId?: unknown;
    }[] | undefined;
    paymentMethodCode?: unknown;
}>;
export declare const cancelBookingSchema: z.ZodObject<{
    reasonCode: z.ZodOptional<z.ZodString>;
    reason: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    reason?: string | undefined;
    reasonCode?: string | undefined;
}, {
    reason?: string | undefined;
    reasonCode?: string | undefined;
}>;
export declare const bookingIdParamSchema: z.ZodObject<{
    bookingId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    bookingId: string;
}, {
    bookingId: string;
}>;
export declare const offerIdParamSchema: z.ZodObject<{
    offerId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    offerId: string;
}, {
    offerId: string;
}>;
export declare const declineOfferSchema: z.ZodObject<{
    offerId: z.ZodOptional<z.ZodString>;
    reason: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    offerId?: string | undefined;
    reason?: string | undefined;
}, {
    offerId?: string | undefined;
    reason?: string | undefined;
}>;
export declare const driverCancelBookingSchema: z.ZodObject<{
    reason: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    reason?: string | undefined;
}, {
    reason?: string | undefined;
}>;
export declare const driverBookingStatusSchema: z.ZodObject<{
    status: z.ZodEnum<["driver_en_route", "arrived", "in_progress", "completed"]>;
}, "strip", z.ZodTypeAny, {
    status: "in_progress" | "driver_en_route" | "arrived" | "completed";
}, {
    status: "in_progress" | "driver_en_route" | "arrived" | "completed";
}>;
export declare const assignDriverCategorySchema: z.ZodObject<{
    driverId: z.ZodString;
    serviceCategoryId: z.ZodString;
    isPrimary: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    driverId: string;
    serviceCategoryId: string;
    isPrimary?: boolean | undefined;
}, {
    driverId: string;
    serviceCategoryId: string;
    isPrimary?: boolean | undefined;
}>;
export declare const placesAutocompleteQuerySchema: z.ZodObject<{
    input: z.ZodString;
    lat: z.ZodOptional<z.ZodNumber>;
    lng: z.ZodOptional<z.ZodNumber>;
    city: z.ZodOptional<z.ZodString>;
    country: z.ZodOptional<z.ZodString>;
    sessionToken: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    input: string;
    city?: string | undefined;
    country?: string | undefined;
    lat?: number | undefined;
    lng?: number | undefined;
    sessionToken?: string | undefined;
}, {
    input: string;
    city?: string | undefined;
    country?: string | undefined;
    lat?: number | undefined;
    lng?: number | undefined;
    sessionToken?: string | undefined;
}>;
export declare const placeDetailsQuerySchema: z.ZodObject<{
    placeId: z.ZodString;
    sessionToken: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    placeId: string;
    sessionToken?: string | undefined;
}, {
    placeId: string;
    sessionToken?: string | undefined;
}>;
export declare const reverseGeocodeQuerySchema: z.ZodObject<{
    lat: z.ZodNumber;
    lng: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    lat: number;
    lng: number;
}, {
    lat: number;
    lng: number;
}>;
export declare const pickupSpotsQuerySchema: z.ZodObject<{
    lat: z.ZodNumber;
    lng: z.ZodNumber;
    address: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    lat: number;
    lng: number;
    address?: string | undefined;
}, {
    lat: number;
    lng: number;
    address?: string | undefined;
}>;
export declare const routePreviewSchema: z.ZodObject<{
    pickup: z.ZodObject<{
        latitude: z.ZodNumber;
        longitude: z.ZodNumber;
    } & {
        address: z.ZodOptional<z.ZodString>;
        placeId: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        latitude: number;
        longitude: number;
        address?: string | undefined;
        placeId?: string | undefined;
    }, {
        latitude: number;
        longitude: number;
        address?: string | undefined;
        placeId?: string | undefined;
    }>;
    dropoff: z.ZodObject<{
        latitude: z.ZodNumber;
        longitude: z.ZodNumber;
    } & {
        address: z.ZodOptional<z.ZodString>;
        placeId: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        latitude: number;
        longitude: number;
        address?: string | undefined;
        placeId?: string | undefined;
    }, {
        latitude: number;
        longitude: number;
        address?: string | undefined;
        placeId?: string | undefined;
    }>;
    stops: z.ZodOptional<z.ZodArray<z.ZodObject<{
        latitude: z.ZodNumber;
        longitude: z.ZodNumber;
    } & {
        address: z.ZodOptional<z.ZodString>;
        placeId: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        latitude: number;
        longitude: number;
        address?: string | undefined;
        placeId?: string | undefined;
    }, {
        latitude: number;
        longitude: number;
        address?: string | undefined;
        placeId?: string | undefined;
    }>, "many">>;
    travelMode: z.ZodOptional<z.ZodEnum<["DRIVE", "TWO_WHEELER"]>>;
    routePreference: z.ZodOptional<z.ZodEnum<["TRAFFIC_AWARE", "TRAFFIC_UNAWARE"]>>;
}, "strip", z.ZodTypeAny, {
    pickup: {
        latitude: number;
        longitude: number;
        address?: string | undefined;
        placeId?: string | undefined;
    };
    dropoff: {
        latitude: number;
        longitude: number;
        address?: string | undefined;
        placeId?: string | undefined;
    };
    stops?: {
        latitude: number;
        longitude: number;
        address?: string | undefined;
        placeId?: string | undefined;
    }[] | undefined;
    travelMode?: "DRIVE" | "TWO_WHEELER" | undefined;
    routePreference?: "TRAFFIC_AWARE" | "TRAFFIC_UNAWARE" | undefined;
}, {
    pickup: {
        latitude: number;
        longitude: number;
        address?: string | undefined;
        placeId?: string | undefined;
    };
    dropoff: {
        latitude: number;
        longitude: number;
        address?: string | undefined;
        placeId?: string | undefined;
    };
    stops?: {
        latitude: number;
        longitude: number;
        address?: string | undefined;
        placeId?: string | undefined;
    }[] | undefined;
    travelMode?: "DRIVE" | "TWO_WHEELER" | undefined;
    routePreference?: "TRAFFIC_AWARE" | "TRAFFIC_UNAWARE" | undefined;
}>;
export declare const savePlaceSchema: z.ZodObject<{
    label: z.ZodString;
    address: z.ZodString;
    latitude: z.ZodNumber;
    longitude: z.ZodNumber;
    placeId: z.ZodOptional<z.ZodString>;
    city: z.ZodOptional<z.ZodString>;
    countryCode: z.ZodOptional<z.ZodString>;
    placeType: z.ZodDefault<z.ZodEnum<["home", "work", "favorite", "recent"]>>;
}, "strip", z.ZodTypeAny, {
    latitude: number;
    longitude: number;
    label: string;
    address: string;
    placeType: "recent" | "home" | "work" | "favorite";
    placeId?: string | undefined;
    city?: string | undefined;
    countryCode?: string | undefined;
}, {
    latitude: number;
    longitude: number;
    label: string;
    address: string;
    placeId?: string | undefined;
    city?: string | undefined;
    countryCode?: string | undefined;
    placeType?: "recent" | "home" | "work" | "favorite" | undefined;
}>;
export declare const updatePlaceSchema: z.ZodEffects<z.ZodObject<{
    label: z.ZodOptional<z.ZodString>;
    address: z.ZodOptional<z.ZodString>;
    latitude: z.ZodOptional<z.ZodNumber>;
    longitude: z.ZodOptional<z.ZodNumber>;
    placeId: z.ZodOptional<z.ZodOptional<z.ZodString>>;
    city: z.ZodOptional<z.ZodOptional<z.ZodString>>;
    countryCode: z.ZodOptional<z.ZodOptional<z.ZodString>>;
    placeType: z.ZodOptional<z.ZodDefault<z.ZodEnum<["home", "work", "favorite", "recent"]>>>;
}, "strip", z.ZodTypeAny, {
    latitude?: number | undefined;
    longitude?: number | undefined;
    label?: string | undefined;
    address?: string | undefined;
    placeId?: string | undefined;
    city?: string | undefined;
    countryCode?: string | undefined;
    placeType?: "recent" | "home" | "work" | "favorite" | undefined;
}, {
    latitude?: number | undefined;
    longitude?: number | undefined;
    label?: string | undefined;
    address?: string | undefined;
    placeId?: string | undefined;
    city?: string | undefined;
    countryCode?: string | undefined;
    placeType?: "recent" | "home" | "work" | "favorite" | undefined;
}>, {
    latitude?: number | undefined;
    longitude?: number | undefined;
    label?: string | undefined;
    address?: string | undefined;
    placeId?: string | undefined;
    city?: string | undefined;
    countryCode?: string | undefined;
    placeType?: "recent" | "home" | "work" | "favorite" | undefined;
}, {
    latitude?: number | undefined;
    longitude?: number | undefined;
    label?: string | undefined;
    address?: string | undefined;
    placeId?: string | undefined;
    city?: string | undefined;
    countryCode?: string | undefined;
    placeType?: "recent" | "home" | "work" | "favorite" | undefined;
}>;
export declare const placeIdParamSchema: z.ZodObject<{
    placeId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    placeId: string;
}, {
    placeId: string;
}>;
export declare const nearbyDriversQuerySchema: z.ZodObject<{
    lat: z.ZodNumber;
    lng: z.ZodNumber;
    serviceCategoryId: z.ZodString;
    radiusKm: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    serviceCategoryId: string;
    lat: number;
    lng: number;
    radiusKm?: number | undefined;
}, {
    serviceCategoryId: string;
    lat: number;
    lng: number;
    radiusKm?: number | undefined;
}>;
export declare const placeSuggestionsQuerySchema: z.ZodObject<{
    lat: z.ZodOptional<z.ZodNumber>;
    lng: z.ZodOptional<z.ZodNumber>;
    limit: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    limit?: number | undefined;
    lat?: number | undefined;
    lng?: number | undefined;
}, {
    limit?: number | undefined;
    lat?: number | undefined;
    lng?: number | undefined;
}>;
export declare const liveVideoChunkSchema: z.ZodObject<{
    sessionId: z.ZodString;
    segmentIndex: z.ZodNumber;
    durationSeconds: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    sessionId: string;
    segmentIndex: number;
    durationSeconds?: number | undefined;
}, {
    sessionId: string;
    segmentIndex: number;
    durationSeconds?: number | undefined;
}>;
export declare const recordingConsentSchema: z.ZodObject<{
    consent: z.ZodBoolean;
    consentVersion: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    consent: boolean;
    consentVersion?: string | undefined;
}, {
    consent: boolean;
    consentVersion?: string | undefined;
}>;
export declare const videoSessionParamSchema: z.ZodObject<{
    sessionId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    sessionId: string;
}, {
    sessionId: string;
}>;
export declare const videoSegmentParamSchema: z.ZodObject<{
    sessionId: z.ZodString;
    segmentId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    sessionId: string;
    segmentId: string;
}, {
    sessionId: string;
    segmentId: string;
}>;
export declare const videoSegmentIdParamSchema: z.ZodObject<{
    segmentId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    segmentId: string;
}, {
    segmentId: string;
}>;
export declare const registerVideoSegmentSchema: z.ZodObject<{
    clientSegmentId: z.ZodString;
    sequenceNumber: z.ZodNumber;
    durationMs: z.ZodOptional<z.ZodNumber>;
    fileSizeBytes: z.ZodOptional<z.ZodNumber>;
    mimeType: z.ZodEnum<["video/mp4", "video/quicktime"]>;
    recordedAt: z.ZodOptional<z.ZodString>;
    checksum: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    mimeType: "video/mp4" | "video/quicktime";
    sequenceNumber: number;
    clientSegmentId: string;
    durationMs?: number | undefined;
    fileSizeBytes?: number | undefined;
    checksum?: string | undefined;
    recordedAt?: string | undefined;
}, {
    mimeType: "video/mp4" | "video/quicktime";
    sequenceNumber: number;
    clientSegmentId: string;
    durationMs?: number | undefined;
    fileSizeBytes?: number | undefined;
    checksum?: string | undefined;
    recordedAt?: string | undefined;
}>;
export declare const completeVideoSegmentSchema: z.ZodObject<{
    checksum: z.ZodOptional<z.ZodString>;
    fileSizeBytes: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    fileSizeBytes?: number | undefined;
    checksum?: string | undefined;
}, {
    fileSizeBytes?: number | undefined;
    checksum?: string | undefined;
}>;
export declare const failVideoSegmentSchema: z.ZodObject<{
    reason: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    reason?: string | undefined;
}, {
    reason?: string | undefined;
}>;
export declare const videoSegmentListQuerySchema: z.ZodObject<{
    status: z.ZodOptional<z.ZodEnum<["pending", "uploading", "uploaded", "verified", "failed"]>>;
}, "strip", z.ZodTypeAny, {
    status?: "uploaded" | "pending" | "failed" | "verified" | "uploading" | undefined;
}, {
    status?: "uploaded" | "pending" | "failed" | "verified" | "uploading" | undefined;
}>;
/**
 * Middleware factory for validating request data
 *
 * @param schema - Zod schema to validate against
 * @param source - Where to find the data ('body', 'query', 'params')
 */
import { Request, Response, NextFunction } from 'express';
export declare const validate: (schema: z.ZodSchema, source?: "body" | "query" | "params") => (req: Request, res: Response, next: NextFunction) => void;
//# sourceMappingURL=index.d.ts.map