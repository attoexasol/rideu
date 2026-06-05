import { db } from './connection';
import { drivers, vehicles, adminUsers, locations, trips } from './schema';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

/**
 * Database seed script
 * Populates database with test data for development
 */
async function seedDatabase() {
  console.log('🌱 Starting database seeding...');

  try {
    // 1. Create test vehicles
    console.log('📦 Creating test vehicles...');
    const vehicleData = [
      {
        make: 'Ford',
        model: 'F-150',
        year: 2022,
        plateNumber: 'ABC-1234',
        vin: '1FTFW1E50MFC12345',
      },
      {
        make: 'Chevrolet',
        model: 'Silverado',
        year: 2023,
        plateNumber: 'XYZ-5678',
        vin: '1GCUYEED0NZ123456',
      },
      {
        make: 'Ram',
        model: '1500',
        year: 2021,
        plateNumber: 'DEF-9012',
        vin: '1C6SRFFT5MN123456',
      },
    ];

    const insertedVehicles = await db.insert(vehicles).values(vehicleData).returning();
    console.log(`✅ Created ${insertedVehicles.length} vehicles`);

    // 2. Create test drivers
    console.log('👤 Creating test drivers...');
    const driverData = [
      {
        auth0Id: 'auth0|test-driver-1',
        email: 'driver1@drivewize.com',
        name: 'John Smith',
        phone: '+1-555-0101',
        status: 'online',
        vehicleId: insertedVehicles[0].id,
        lastSeen: new Date(),
      },
      {
        auth0Id: 'auth0|test-driver-2',
        email: 'driver2@drivewize.com',
        name: 'Sarah Johnson',
        phone: '+1-555-0102',
        status: 'online',
        vehicleId: insertedVehicles[1].id,
        lastSeen: new Date(),
      },
      {
        auth0Id: 'auth0|test-driver-3',
        email: 'driver3@drivewize.com',
        name: 'Mike Davis',
        phone: '+1-555-0103',
        status: 'online',
        vehicleId: insertedVehicles[2].id,
        lastSeen: new Date(Date.now() - 600000), // 10 minutes ago
      },
      {
        auth0Id: 'auth0|test-driver-4',
        email: 'driver4@drivewize.com',
        name: 'Emily Brown',
        phone: '+1-555-0104',
        status: 'offline',
        vehicleId: null,
        lastSeen: new Date(Date.now() - 3600000), // 1 hour ago
      },
      {
        auth0Id: 'auth0|test-driver-5',
        email: 'driver5@drivewize.com',
        name: 'David Wilson',
        phone: '+1-555-0105',
        status: 'online',
        vehicleId: null,
        lastSeen: new Date(),
      },
    ];

    const insertedDrivers = await db.insert(drivers).values(driverData).returning();
    console.log(`✅ Created ${insertedDrivers.length} drivers`);

    // 3. Create test admin users
    console.log('👔 Creating test admin users...');
    const adminData = [
      {
        auth0Id: 'auth0|test-admin-1',
        email: 'admin@drivewize.com',
        name: 'Admin User',
        role: 'admin',
      },
      {
        auth0Id: 'auth0|test-admin-2',
        email: 'superadmin@drivewize.com',
        name: 'Super Admin',
        role: 'super_admin',
      },
      {
        auth0Id: 'auth0|test-admin-3',
        email: 'manager@drivewize.com',
        name: 'Fleet Manager',
        role: 'admin',
      },
    ];

    const insertedAdmins = await db.insert(adminUsers).values(adminData).returning();
    console.log(`✅ Created ${insertedAdmins.length} admin users`);

    // 4. Create sample location data for ALL drivers - San Diego area
    console.log('📍 Creating sample location data...');
    const locationData = [
      // Driver 1 - John Smith (online) - Downtown San Diego
      {
        driverId: insertedDrivers[0].id,
        latitude: '32.71573000',
        longitude: '-117.16172000',
        accuracy: '5.00',
        speed: '25.30',
        heading: '180.00',
        timestamp: new Date(), // now
      },
      // Driver 2 - Sarah Johnson (active) - La Jolla
      {
        driverId: insertedDrivers[1].id,
        latitude: '32.84000000',
        longitude: '-117.27000000',
        accuracy: '5.50',
        speed: '32.00',
        heading: '95.00',
        timestamp: new Date(), // now
      },
      // Driver 3 - Mike Davis (idle) - Pacific Beach
      {
        driverId: insertedDrivers[2].id,
        latitude: '32.79000000',
        longitude: '-117.23000000',
        accuracy: '6.00',
        speed: '0.00',
        heading: '0.00',
        timestamp: new Date(Date.now() - 600000), // 10 minutes ago (idle)
      },
      // Driver 4 - Emily Brown (offline) - Mission Valley
      {
        driverId: insertedDrivers[3].id,
        latitude: '32.77000000',
        longitude: '-117.16000000',
        accuracy: '7.00',
        speed: '0.00',
        heading: '0.00',
        timestamp: new Date(Date.now() - 3600000), // 1 hour ago
      },
      // Driver 5 - David Wilson (online) - Coronado
      {
        driverId: insertedDrivers[4].id,
        latitude: '32.68000000',
        longitude: '-117.17000000',
        accuracy: '5.00',
        speed: '20.00',
        heading: '45.00',
        timestamp: new Date(), // now
      },
    ];

    const insertedLocations = await db.insert(locations).values(locationData).returning();
    console.log(`✅ Created ${insertedLocations.length} location records`);

    // 5. Create sample trip data
    console.log('🚗 Creating sample trip data...');
    const tripData = [
      // Completed trip for Driver 1
      {
        driverId: insertedDrivers[0].id,
        startTime: new Date(Date.now() - 7200000), // 2 hours ago
        endTime: new Date(Date.now() - 3600000), // 1 hour ago
        distance: '25.50',
        status: 'completed',
        startLocationId: insertedLocations[0].id,
        endLocationId: insertedLocations[1].id,
      },
      // In-progress trip for Driver 2
      {
        driverId: insertedDrivers[1].id,
        startTime: new Date(Date.now() - 1800000), // 30 minutes ago
        endTime: null,
        distance: null,
        status: 'in_progress',
        startLocationId: insertedLocations[1].id,
        endLocationId: null,
      },
      // Completed trip for Driver 3
      {
        driverId: insertedDrivers[2].id,
        startTime: new Date(Date.now() - 14400000), // 4 hours ago
        endTime: new Date(Date.now() - 10800000), // 3 hours ago
        distance: '15.30',
        status: 'completed',
        startLocationId: insertedLocations[2].id,
        endLocationId: insertedLocations[3].id,
      },
      // Completed trip for Driver 4
      {
        driverId: insertedDrivers[3].id,
        startTime: new Date(Date.now() - 3600000), // 1 hour ago
        endTime: new Date(Date.now() - 1800000), // 30 minutes ago
        distance: '8.20',
        status: 'completed',
        startLocationId: insertedLocations[3].id,
        endLocationId: insertedLocations[4].id,
      },
    ];

    const insertedTrips = await db.insert(trips).values(tripData).returning();
    console.log(`✅ Created ${insertedTrips.length} trip records`);

    console.log('\n✨ Database seeding completed successfully!');
    console.log('\n📊 Summary:');
    console.log(`   - ${insertedVehicles.length} vehicles`);
    console.log(`   - ${insertedDrivers.length} drivers`);
    console.log(`   - ${insertedAdmins.length} admin users`);
    console.log(`   - ${insertedLocations.length} location records`);
    console.log(`   - ${insertedTrips.length} trips`);

    process.exit(0);
  } catch (error) {
    console.error('❌ Seeding failed:', error);
    process.exit(1);
  }
}

seedDatabase();
