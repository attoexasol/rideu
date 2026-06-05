/**
 * Request Validation Schemas using Zod
 *
 * All API request validation schemas
 */
import { z } from 'zod';
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
export declare const createDriverSchema: z.ZodObject<{
    email: z.ZodString;
    password: z.ZodString;
    name: z.ZodString;
    phone: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
    vehicleType: z.ZodEffects<z.ZodOptional<z.ZodEnum<["sedan", "suv", "van", "mini_bus", "coach_bus"]>>, "sedan" | "suv" | "van" | "mini_bus" | "coach_bus" | undefined, unknown>;
    vehicleId: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
    cabName: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
    cabNumber: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
    vehicleMake: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
    vehicleModel: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
    vehicleYear: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
    vehicleColor: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>;
}, "strip", z.ZodTypeAny, {
    name: string;
    email: string;
    password: string;
    phone?: string | undefined;
    vehicleType?: "sedan" | "suv" | "van" | "mini_bus" | "coach_bus" | undefined;
    vehicleId?: string | undefined;
    cabName?: string | undefined;
    cabNumber?: string | undefined;
    vehicleMake?: string | undefined;
    vehicleModel?: string | undefined;
    vehicleYear?: string | undefined;
    vehicleColor?: string | undefined;
}, {
    name: string;
    email: string;
    password: string;
    phone?: unknown;
    vehicleType?: unknown;
    vehicleId?: unknown;
    cabName?: unknown;
    cabNumber?: unknown;
    vehicleMake?: unknown;
    vehicleModel?: unknown;
    vehicleYear?: unknown;
    vehicleColor?: unknown;
}>;
export declare const updateDriverSchema: z.ZodObject<{
    name: z.ZodOptional<z.ZodString>;
    phone: z.ZodEffects<z.ZodNullable<z.ZodOptional<z.ZodString>>, string | null | undefined, unknown>;
    vehicleType: z.ZodEffects<z.ZodNullable<z.ZodOptional<z.ZodEnum<["sedan", "suv", "van", "mini_bus", "coach_bus"]>>>, "sedan" | "suv" | "van" | "mini_bus" | "coach_bus" | null | undefined, unknown>;
    vehicleId: z.ZodEffects<z.ZodNullable<z.ZodOptional<z.ZodString>>, string | null | undefined, unknown>;
    cabName: z.ZodEffects<z.ZodNullable<z.ZodOptional<z.ZodString>>, string | null | undefined, unknown>;
    cabNumber: z.ZodEffects<z.ZodNullable<z.ZodOptional<z.ZodString>>, string | null | undefined, unknown>;
    vehicleMake: z.ZodEffects<z.ZodNullable<z.ZodOptional<z.ZodString>>, string | null | undefined, unknown>;
    vehicleModel: z.ZodEffects<z.ZodNullable<z.ZodOptional<z.ZodString>>, string | null | undefined, unknown>;
    vehicleYear: z.ZodEffects<z.ZodNullable<z.ZodOptional<z.ZodString>>, string | null | undefined, unknown>;
    vehicleColor: z.ZodEffects<z.ZodNullable<z.ZodOptional<z.ZodString>>, string | null | undefined, unknown>;
    status: z.ZodOptional<z.ZodEnum<["online", "offline"]>>;
}, "strip", z.ZodTypeAny, {
    name?: string | undefined;
    phone?: string | null | undefined;
    status?: "online" | "offline" | undefined;
    vehicleType?: "sedan" | "suv" | "van" | "mini_bus" | "coach_bus" | null | undefined;
    vehicleId?: string | null | undefined;
    cabName?: string | null | undefined;
    cabNumber?: string | null | undefined;
    vehicleMake?: string | null | undefined;
    vehicleModel?: string | null | undefined;
    vehicleYear?: string | null | undefined;
    vehicleColor?: string | null | undefined;
}, {
    name?: string | undefined;
    phone?: unknown;
    status?: "online" | "offline" | undefined;
    vehicleType?: unknown;
    vehicleId?: unknown;
    cabName?: unknown;
    cabNumber?: unknown;
    vehicleMake?: unknown;
    vehicleModel?: unknown;
    vehicleYear?: unknown;
    vehicleColor?: unknown;
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
    search?: string | undefined;
    status?: "online" | "offline" | undefined;
    vehicleType?: "sedan" | "suv" | "van" | "mini_bus" | "coach_bus" | undefined;
}, {
    search?: string | undefined;
    status?: "online" | "offline" | undefined;
    vehicleType?: "sedan" | "suv" | "van" | "mini_bus" | "coach_bus" | undefined;
    limit?: string | undefined;
    page?: string | undefined;
}>;
export declare const submitLocationSchema: z.ZodObject<{
    latitude: z.ZodNumber;
    longitude: z.ZodNumber;
    accuracy: z.ZodOptional<z.ZodNumber>;
    speed: z.ZodOptional<z.ZodNumber>;
    heading: z.ZodOptional<z.ZodNumber>;
    timestamp: z.ZodString;
}, "strip", z.ZodTypeAny, {
    latitude: number;
    longitude: number;
    timestamp: string;
    accuracy?: number | undefined;
    speed?: number | undefined;
    heading?: number | undefined;
}, {
    latitude: number;
    longitude: number;
    timestamp: string;
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
    status?: "in_progress" | "completed" | "cancelled" | undefined;
    limit?: string | undefined;
    page?: string | undefined;
    startDate?: string | undefined;
    endDate?: string | undefined;
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
/**
 * Middleware factory for validating request data
 *
 * @param schema - Zod schema to validate against
 * @param source - Where to find the data ('body', 'query', 'params')
 */
import { Request, Response, NextFunction } from 'express';
export declare const validate: (schema: z.ZodSchema, source?: "body" | "query" | "params") => (req: Request, res: Response, next: NextFunction) => void;
//# sourceMappingURL=index.d.ts.map