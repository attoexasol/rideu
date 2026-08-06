import { videoConfig } from '../config/video';
import { startRideVideoRecoveryPoller } from './rideVideoRecovery.service';

let recoveryInterval: NodeJS.Timeout | undefined;

export function startRideVideoBackgroundJobs(): NodeJS.Timeout | undefined {
  if (!videoConfig.enabled) return undefined;
  recoveryInterval = startRideVideoRecoveryPoller();
  return recoveryInterval;
}

export function stopRideVideoBackgroundJobs(): void {
  if (recoveryInterval) {
    clearInterval(recoveryInterval);
    recoveryInterval = undefined;
  }
}
