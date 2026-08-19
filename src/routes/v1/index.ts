import express from 'express';
import passengerAuthRoutes from './passenger/auth';
import passengerProfileRoutes from './passenger/profile';
import passengerRoutes from './passenger/index';
import driverBookingRoutes from './driver/bookings';
import driverVideoRoutes from './driver/video';
import driverDutyRoutes from './driver/duty';
import driverVehicleExchangeRoutes from './driver/vehicle-exchanges';
import driverPushRoutes from './driver/push';
import passengerPushRoutes from './passenger/push';
import driverProfileRoutes from './driver/profile';
import adminBookingRoutes from './admin/booking';
import adminFleetRoutes from './admin/fleet';
import adminRideVideoRoutes from './admin/rideVideos';
import adminPassengerRoutes from './admin/passengers';

const router = express.Router();

router.use('/passenger/auth', passengerAuthRoutes);
router.use('/passenger/profile', passengerProfileRoutes);
router.use('/passenger/push-token', passengerPushRoutes);
router.use('/passenger', passengerRoutes);
router.use('/driver/profile', driverProfileRoutes);
router.use('/driver/bookings', driverBookingRoutes);
router.use('/driver/video', driverVideoRoutes);
router.use('/driver/duty', driverDutyRoutes);
router.use('/driver/vehicle-exchanges', driverVehicleExchangeRoutes);
router.use('/driver/push-token', driverPushRoutes);
router.use('/admin', adminBookingRoutes);
router.use('/admin', adminRideVideoRoutes);
router.use('/admin/passengers', adminPassengerRoutes);
router.use('/admin/fleet', adminFleetRoutes);

export default router;
