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
export declare const VEHICLE_TYPES: Record<VehicleType, VehicleTypeInfo>;
export declare const VEHICLE_TYPE_OPTIONS: VehicleTypeInfo[];
export declare const getVehicleTypeInfo: (type: VehicleType | null | undefined) => VehicleTypeInfo | null;
export declare const getVehicleTypeLabel: (type: VehicleType | null | undefined) => string;
export declare const getVehicleTypeIcon: (type: VehicleType | null | undefined) => string;
//# sourceMappingURL=vehicleTypes.d.ts.map