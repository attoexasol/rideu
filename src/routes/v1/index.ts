import express from 'express';
import passengerAuthRoutes from './passenger/auth';
import passengerRoutes from './passenger/index';
import driverBookingRoutes from './driver/bookings';
import driverVideoRoutes from './driver/video';
import driverDutyRoutes from './driver/duty';
import driverVehicleExchangeRoutes from './driver/vehicle-exchanges';
import adminBookingRoutes from './admin/booking';
import adminFleetRoutes from './admin/fleet';
import adminRideVideoRoutes from './admin/rideVideos';

const router = express.Router();

router.use('/passenger/auth', passengerAuthRoutes);
router.use('/passenger', passengerRoutes);
router.use('/driver/bookings', driverBookingRoutes);
router.use('/driver/video', driverVideoRoutes);
router.use('/driver/duty', driverDutyRoutes);
router.use('/driver/vehicle-exchanges', driverVehicleExchangeRoutes);
router.use('/admin', adminBookingRoutes);
router.use('/admin', adminRideVideoRoutes);
router.use('/admin/fleet', adminFleetRoutes);

export default router;
