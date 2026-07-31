/**
 * Database Schema Index
 * Exports all table schemas and types for the DriveWize GPS Tracking System
 */

export * from './drivers';
export * from './locations';
export * from './trips';
export * from './admin_users';
export * from './sessions';
export * from './vehicles';
export * from './logs';
export * from './driver_vehicle_assignments';
export * from './driver_attendance';
export * from './trip_videos';
export * from './customers';
export * from './customer_places';
export * from './service_categories';
export * from './driver_service_categories';
export * from './promotions';
export * from './payment_methods';
export * from './bookings';
export * from './booking_stops';
export * from './booking_offers';
export * from './booking_events';
export * from './booking_idempotency';
export * from './video_sessions';
export * from './video_segments';
export * from './organizations';
export * from './fleets';
export * from './driver_fleet_memberships';
export * from './duty_sessions';
export * from './vehicle_qr_tokens';
export * from './vehicle_service_categories';
export * from './fleet_audit_events';
export * from './vehicle_exchange_requests';
export * from './vehicle_exchange_events';
export * from './vehicle_exchange_resource_locks';

import { drivers } from './drivers';
import { locations } from './locations';
import { trips } from './trips';
import { adminUsers } from './admin_users';
import { sessions } from './sessions';
import { vehicles } from './vehicles';
import { logs } from './logs';
import { driverVehicleAssignments } from './driver_vehicle_assignments';
import { driverAttendance } from './driver_attendance';
import { tripVideos } from './trip_videos';
import { customers } from './customers';
import { customerPlaces } from './customer_places';
import { serviceCategories } from './service_categories';
import { driverServiceCategories } from './driver_service_categories';
import { promotions } from './promotions';
import { paymentMethods } from './payment_methods';
import { bookings } from './bookings';
import { bookingStops } from './booking_stops';
import { bookingOffers } from './booking_offers';
import { bookingEvents } from './booking_events';
import { videoSessions } from './video_sessions';
import { bookingIdempotencyKeys } from './booking_idempotency';
import { videoSegments } from './video_segments';
import { organizations } from './organizations';
import { fleets } from './fleets';
import { driverFleetMemberships } from './driver_fleet_memberships';
import { dutySessions } from './duty_sessions';
import { vehicleQrTokens } from './vehicle_qr_tokens';
import { vehicleServiceCategories } from './vehicle_service_categories';
import { fleetAuditEvents } from './fleet_audit_events';
import { vehicleExchangeRequests } from './vehicle_exchange_requests';
import { vehicleExchangeEvents } from './vehicle_exchange_events';
import { vehicleExchangeResourceLocks } from './vehicle_exchange_resource_locks';

export const schema = {
  drivers,
  locations,
  trips,
  adminUsers,
  sessions,
  vehicles,
  logs,
  driverVehicleAssignments,
  driverAttendance,
  tripVideos,
  customers,
  customerPlaces,
  serviceCategories,
  driverServiceCategories,
  promotions,
  paymentMethods,
  bookings,
  bookingStops,
  bookingOffers,
  bookingEvents,
  bookingIdempotencyKeys,
  videoSessions,
  videoSegments,
  organizations,
  fleets,
  driverFleetMemberships,
  dutySessions,
  vehicleQrTokens,
  vehicleServiceCategories,
  fleetAuditEvents,
  vehicleExchangeRequests,
  vehicleExchangeEvents,
  vehicleExchangeResourceLocks,
};
