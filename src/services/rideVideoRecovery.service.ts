import { videoConfig } from '../config/video';
import { logger } from '../middleware/logger';
import { reconcileStaleSessions } from './rideVideoDvr.service';

export function startRideVideoRecoveryPoller(): NodeJS.Timeout {
  const intervalMs = videoConfig.recoveryPollIntervalSeconds * 1000;
  const tick = () => {
    reconcileStaleSessions()
      .then((count) => {
        if (count > 0) {
          logger.info({ event: 'ride_video.recovery', reconciledSessions: count });
        }
      })
      .catch((error) => {
        logger.error({ event: 'ride_video.recovery_failed', error: String(error) });
      });
  };

  tick();
  return setInterval(tick, intervalMs);
}
