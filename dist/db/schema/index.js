"use strict";
/**
 * Database Schema Index
 * Exports all table schemas and types for the DriveWize GPS Tracking System
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.schema = void 0;
__exportStar(require("./drivers"), exports);
__exportStar(require("./locations"), exports);
__exportStar(require("./trips"), exports);
__exportStar(require("./admin_users"), exports);
__exportStar(require("./sessions"), exports);
__exportStar(require("./vehicles"), exports);
__exportStar(require("./logs"), exports);
__exportStar(require("./driver_vehicle_assignments"), exports);
__exportStar(require("./driver_attendance"), exports);
__exportStar(require("./trip_videos"), exports);
__exportStar(require("./customers"), exports);
__exportStar(require("./customer_places"), exports);
__exportStar(require("./service_categories"), exports);
__exportStar(require("./driver_service_categories"), exports);
__exportStar(require("./promotions"), exports);
__exportStar(require("./payment_methods"), exports);
__exportStar(require("./bookings"), exports);
__exportStar(require("./booking_stops"), exports);
__exportStar(require("./booking_offers"), exports);
__exportStar(require("./booking_events"), exports);
__exportStar(require("./booking_idempotency"), exports);
__exportStar(require("./video_sessions"), exports);
__exportStar(require("./video_segments"), exports);
__exportStar(require("./ride_video_audit_events"), exports);
__exportStar(require("./organizations"), exports);
__exportStar(require("./fleets"), exports);
__exportStar(require("./driver_fleet_memberships"), exports);
__exportStar(require("./duty_sessions"), exports);
__exportStar(require("./vehicle_qr_tokens"), exports);
__exportStar(require("./vehicle_service_categories"), exports);
__exportStar(require("./fleet_audit_events"), exports);
__exportStar(require("./vehicle_exchange_requests"), exports);
__exportStar(require("./vehicle_exchange_events"), exports);
__exportStar(require("./vehicle_exchange_resource_locks"), exports);
__exportStar(require("./driver_push_tokens"), exports);
__exportStar(require("./passenger_push_tokens"), exports);
__exportStar(require("./booking_payments"), exports);
__exportStar(require("./booking_settlements"), exports);
__exportStar(require("./settlement_settings"), exports);
__exportStar(require("./airports"), exports);
__exportStar(require("./ride_markets"), exports);
__exportStar(require("./service_category_market_fares"), exports);
__exportStar(require("./stripe_webhook_events"), exports);
__exportStar(require("./driver_documents"), exports);
__exportStar(require("./service_areas"), exports);
__exportStar(require("./meter_rate_schedules"), exports);
__exportStar(require("./walk_up_trips"), exports);
__exportStar(require("./meter_sessions"), exports);
__exportStar(require("./meter_payments"), exports);
const drivers_1 = require("./drivers");
const locations_1 = require("./locations");
const trips_1 = require("./trips");
const admin_users_1 = require("./admin_users");
const sessions_1 = require("./sessions");
const vehicles_1 = require("./vehicles");
const logs_1 = require("./logs");
const driver_vehicle_assignments_1 = require("./driver_vehicle_assignments");
const driver_attendance_1 = require("./driver_attendance");
const trip_videos_1 = require("./trip_videos");
const customers_1 = require("./customers");
const customer_places_1 = require("./customer_places");
const service_categories_1 = require("./service_categories");
const driver_service_categories_1 = require("./driver_service_categories");
const promotions_1 = require("./promotions");
const payment_methods_1 = require("./payment_methods");
const bookings_1 = require("./bookings");
const booking_stops_1 = require("./booking_stops");
const booking_offers_1 = require("./booking_offers");
const booking_events_1 = require("./booking_events");
const video_sessions_1 = require("./video_sessions");
const booking_idempotency_1 = require("./booking_idempotency");
const video_segments_1 = require("./video_segments");
const ride_video_audit_events_1 = require("./ride_video_audit_events");
const organizations_1 = require("./organizations");
const fleets_1 = require("./fleets");
const driver_fleet_memberships_1 = require("./driver_fleet_memberships");
const duty_sessions_1 = require("./duty_sessions");
const vehicle_qr_tokens_1 = require("./vehicle_qr_tokens");
const vehicle_service_categories_1 = require("./vehicle_service_categories");
const fleet_audit_events_1 = require("./fleet_audit_events");
const vehicle_exchange_requests_1 = require("./vehicle_exchange_requests");
const vehicle_exchange_events_1 = require("./vehicle_exchange_events");
const vehicle_exchange_resource_locks_1 = require("./vehicle_exchange_resource_locks");
const driver_push_tokens_1 = require("./driver_push_tokens");
const passenger_push_tokens_1 = require("./passenger_push_tokens");
const booking_payments_1 = require("./booking_payments");
const booking_settlements_1 = require("./booking_settlements");
const settlement_settings_1 = require("./settlement_settings");
const airports_1 = require("./airports");
const ride_markets_1 = require("./ride_markets");
const service_category_market_fares_1 = require("./service_category_market_fares");
const stripe_webhook_events_1 = require("./stripe_webhook_events");
const driver_documents_1 = require("./driver_documents");
const service_areas_1 = require("./service_areas");
const meter_rate_schedules_1 = require("./meter_rate_schedules");
const walk_up_trips_1 = require("./walk_up_trips");
const meter_sessions_1 = require("./meter_sessions");
const meter_payments_1 = require("./meter_payments");
exports.schema = {
    drivers: drivers_1.drivers,
    locations: locations_1.locations,
    trips: trips_1.trips,
    adminUsers: admin_users_1.adminUsers,
    sessions: sessions_1.sessions,
    vehicles: vehicles_1.vehicles,
    logs: logs_1.logs,
    driverVehicleAssignments: driver_vehicle_assignments_1.driverVehicleAssignments,
    driverAttendance: driver_attendance_1.driverAttendance,
    tripVideos: trip_videos_1.tripVideos,
    customers: customers_1.customers,
    customerPlaces: customer_places_1.customerPlaces,
    serviceCategories: service_categories_1.serviceCategories,
    driverServiceCategories: driver_service_categories_1.driverServiceCategories,
    promotions: promotions_1.promotions,
    paymentMethods: payment_methods_1.paymentMethods,
    bookings: bookings_1.bookings,
    bookingStops: booking_stops_1.bookingStops,
    bookingOffers: booking_offers_1.bookingOffers,
    bookingEvents: booking_events_1.bookingEvents,
    bookingIdempotencyKeys: booking_idempotency_1.bookingIdempotencyKeys,
    videoSessions: video_sessions_1.videoSessions,
    videoSegments: video_segments_1.videoSegments,
    rideVideoAuditEvents: ride_video_audit_events_1.rideVideoAuditEvents,
    organizations: organizations_1.organizations,
    fleets: fleets_1.fleets,
    driverFleetMemberships: driver_fleet_memberships_1.driverFleetMemberships,
    dutySessions: duty_sessions_1.dutySessions,
    vehicleQrTokens: vehicle_qr_tokens_1.vehicleQrTokens,
    vehicleServiceCategories: vehicle_service_categories_1.vehicleServiceCategories,
    fleetAuditEvents: fleet_audit_events_1.fleetAuditEvents,
    vehicleExchangeRequests: vehicle_exchange_requests_1.vehicleExchangeRequests,
    vehicleExchangeEvents: vehicle_exchange_events_1.vehicleExchangeEvents,
    vehicleExchangeResourceLocks: vehicle_exchange_resource_locks_1.vehicleExchangeResourceLocks,
    driverPushTokens: driver_push_tokens_1.driverPushTokens,
    passengerPushTokens: passenger_push_tokens_1.passengerPushTokens,
    bookingPayments: booking_payments_1.bookingPayments,
    bookingSettlements: booking_settlements_1.bookingSettlements,
    settlementSettings: settlement_settings_1.settlementSettings,
    airports: airports_1.airports,
    rideMarkets: ride_markets_1.rideMarkets,
    serviceCategoryMarketFares: service_category_market_fares_1.serviceCategoryMarketFares,
    stripeWebhookEvents: stripe_webhook_events_1.stripeWebhookEvents,
    driverDocuments: driver_documents_1.driverDocuments,
    serviceAreas: service_areas_1.serviceAreas,
    meterRateSchedules: meter_rate_schedules_1.meterRateSchedules,
    meterRateScheduleEvents: meter_rate_schedules_1.meterRateScheduleEvents,
    walkUpTrips: walk_up_trips_1.walkUpTrips,
    meterSessions: meter_sessions_1.meterSessions,
    meterGpsSamples: meter_sessions_1.meterGpsSamples,
    meterCalculationEvents: meter_sessions_1.meterCalculationEvents,
    meterFareRecords: meter_sessions_1.meterFareRecords,
    meterPauses: meter_sessions_1.meterPauses,
    meterPayments: meter_payments_1.meterPayments,
};
//# sourceMappingURL=index.js.map