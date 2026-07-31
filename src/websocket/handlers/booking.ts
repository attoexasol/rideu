import { Server, Socket } from 'socket.io';
import { SocketData } from '../types';
import { acceptBookingOffer, rejectBookingOffer } from '../../services/dispatch.service';
import { driverUtils } from '../../db/utils';

export function setupBookingHandler(_io: Server, socket: Socket): void {
  const socketData = socket.data as SocketData;

  socket.on('booking:accept', async (payload: { bookingId: string }, callback) => {
    if (socketData.userType !== 'driver') {
      callback?.({ success: false, error: 'Only drivers can accept bookings' });
      return;
    }
    try {
      const driver = await driverUtils.findByAuth0Id(socketData.auth0Id);
      if (!driver) {
        callback?.({ success: false, error: 'Driver not found' });
        return;
      }
      const result = await acceptBookingOffer(payload.bookingId, driver.id);
      callback?.(result);
    } catch (e) {
      callback?.({
        success: false,
        error: e instanceof Error ? e.message : 'Accept failed',
      });
    }
  });

  socket.on('booking:reject', async (payload: { bookingId: string }, callback) => {
    if (socketData.userType !== 'driver') {
      callback?.({ success: false, error: 'Only drivers can reject bookings' });
      return;
    }
    try {
      const driver = await driverUtils.findByAuth0Id(socketData.auth0Id);
      if (!driver) {
        callback?.({ success: false, error: 'Driver not found' });
        return;
      }
      await rejectBookingOffer(payload.bookingId, driver.id);
      callback?.({ success: true });
    } catch (e) {
      callback?.({
        success: false,
        error: e instanceof Error ? e.message : 'Reject failed',
      });
    }
  });

  socket.on('booking:cancel', async (payload: { bookingId: string; reason?: string }, callback) => {
    if (socketData.userType !== 'customer') {
      callback?.({ success: false, error: 'Only customers can cancel via this event' });
      return;
    }
    try {
      const { cancelBookingByCustomer } = await import('../../services/booking.service');
      await cancelBookingByCustomer(payload.bookingId, socketData.userId, {
        reason: payload.reason,
        reasonCode: (payload as { reasonCode?: string }).reasonCode,
      });
      callback?.({ success: true });
    } catch (e) {
      callback?.({
        success: false,
        error: e instanceof Error ? e.message : 'Cancel failed',
      });
    }
  });
}
