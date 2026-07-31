/**
 * Vehicle Type Constants
 * Defines vehicle types available in the DriveWize fleet
 */

export type VehicleType = 'sedan' | 'suv' | 'van' | 'mini_bus' | 'coach_bus';

export interface VehicleTypeInfo {
  value: VehicleType;
  label: string;
  description: string;
  capacity: string;
  icon: string;
}

export const VEHICLE_TYPES: Record<VehicleType, VehicleTypeInfo> = {
  sedan: {
    value: 'sedan',
    label: 'Sedans',
    description:
      'Business Class Travel - Perfect for solo travelers or small groups, our sedans offer a quiet, professional ride. Ideal for executive travel with seating for up to 3 passengers and space for 2-3 bags.',
    capacity: '3 passengers',
    icon: '🚗',
  },
  suv: {
    value: 'suv',
    label: 'SUVs',
    description:
      'Comfort for Small Groups - Enjoy extra room and comfort for small groups or families. Our SUVs accommodate up to 5 passengers, offering a stylish and spacious ride with ample luggage space.',
    capacity: '5 passengers',
    icon: '🚙',
  },
  van: {
    value: 'van',
    label: 'Vans',
    description:
      'ADA Accessible Options Available - Designed for accessibility and group travel, our vans seat up to 10 passengers. ADA-compliant vehicles with wheelchair lift options ensure comfort and convenience for everyone.',
    capacity: '10 passengers',
    icon: '🚐',
  },
  mini_bus: {
    value: 'mini_bus',
    label: 'Mini Buses',
    description:
      'Mid-Sized Groups - Ideal for medium-sized groups, our mini buses offer comfortable seating for 18–24 passengers. Great for corporate events, airport shuttles, and special group outings.',
    capacity: '18–24 passengers',
    icon: '🚌',
  },
  coach_bus: {
    value: 'coach_bus',
    label: 'Coach Buses',
    description:
      'Large Groups - Move large groups with ease and comfort. Our coach buses seat up to 55 passengers, featuring spacious interiors, climate control, and premium amenities for long-distance travel.',
    capacity: '50–55 passengers',
    icon: '🚍',
  },
};

export const VEHICLE_TYPE_OPTIONS = Object.values(VEHICLE_TYPES);

export const getVehicleTypeInfo = (
  type: VehicleType | null | undefined
): VehicleTypeInfo | null => {
  if (!type) return null;
  return VEHICLE_TYPES[type] || null;
};

export const getVehicleTypeLabel = (type: VehicleType | null | undefined): string => {
  const info = getVehicleTypeInfo(type);
  return info?.label || 'Unknown';
};

export const getVehicleTypeIcon = (type: VehicleType | null | undefined): string => {
  const info = getVehicleTypeInfo(type);
  return info?.icon || '🚗';
};
