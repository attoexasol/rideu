import { db } from '../db/connection';
import { drivers } from '../db/schema/drivers';
import { locations } from '../db/schema/locations';
import { customers } from '../db/schema/customers';
import { tripUtils } from '../db/utils';
import { eq } from 'drizzle-orm';

export interface CurrentTripResponse {
  id: string;
  status: string;
  pickup: string | null;
  dropoff: string | null;
  bookingId?: string | null;
  passenger?: {
    id: string;
    name: string;
    email: string;
  } | null;
}

async function getLocationLabel(locationId: string | null): Promise<string | null> {
  if (!locationId) return null;

  const location = await db.query.locations.findFirst({
    where: eq(locations.id, locationId),
  });

  if (!location) return null;

  return `${location.latitude}, ${location.longitude}`;
}

export async function getCurrentTripForAuth0Driver(
  auth0Id: string
): Promise<{ driverMissing: boolean; trip: CurrentTripResponse | null }> {
  const driver = await db.query.drivers.findFirst({
    where: eq(drivers.auth0Id, auth0Id),
  });

  if (!driver) {
    return { driverMissing: true, trip: null };
  }

  const activeTrip = await tripUtils.getActiveForDriver(driver.id);
  if (!activeTrip) {
    return { driverMissing: false, trip: null };
  }

  const [pickup, dropoff, passenger] = await Promise.all([
    getLocationLabel(activeTrip.startLocationId),
    getLocationLabel(activeTrip.endLocationId),
    activeTrip.customerId
      ? db
          .select({
            id: customers.id,
            name: customers.name,
            email: customers.email,
          })
          .from(customers)
          .where(eq(customers.id, activeTrip.customerId))
          .limit(1)
          .then((r) => r[0] ?? null)
      : Promise.resolve(null),
  ]);

  return {
    driverMissing: false,
    trip: {
      id: activeTrip.id,
      status: activeTrip.status,
      pickup,
      dropoff,
      bookingId: activeTrip.bookingId ?? null,
      passenger,
    },
  };
}
