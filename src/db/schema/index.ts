/**
 * Database Schema Index
 * Exports all table schemas and types for the DriveWize GPS Tracking System
 */

// Import all schemas
export * from './drivers';
export * from './locations';
export * from './trips';
export * from './admin_users';
export * from './sessions';
export * from './vehicles';
export * from './logs';

// Import schemas for combined export
import { drivers } from './drivers';
import { locations } from './locations';
import { trips } from './trips';
import { adminUsers } from './admin_users';
import { sessions } from './sessions';
import { vehicles } from './vehicles';
import { logs } from './logs';

// Export all schemas as a single object for Drizzle ORM
export const schema = {
  drivers,
  locations,
  trips,
  adminUsers,
  sessions,
  vehicles,
  logs,
};
