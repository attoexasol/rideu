import { MeterSessionStatus, type MeterSessionStatusType } from '../../constants/softMeter';
import { MeterError } from './errors';

export type FinalizationAction = 'return_existing' | 'stop_then_claim' | 'claim' | 'reject';

export function beginFinalization(status: MeterSessionStatusType): FinalizationAction {
  if (status === MeterSessionStatus.FINALIZED) return 'return_existing';
  if (status === MeterSessionStatus.RUNNING || status === MeterSessionStatus.PAUSED) {
    return 'stop_then_claim';
  }
  if (status === MeterSessionStatus.STOPPED) return 'claim';
  return 'reject';
}

export function assertCanStart(status: MeterSessionStatusType): { idempotent: boolean } {
  if (status === MeterSessionStatus.PENDING) return { idempotent: false };
  if (
    status === MeterSessionStatus.RUNNING ||
    status === MeterSessionStatus.PAUSED ||
    status === MeterSessionStatus.STOPPED ||
    status === MeterSessionStatus.FINALIZED
  ) {
    return { idempotent: true };
  }
  throw new MeterError('METER_NOT_STARTABLE', `Meter cannot start from status ${status}.`, 409);
}

export function assertCanStop(status: MeterSessionStatusType): { idempotent: boolean } {
  if (status === MeterSessionStatus.RUNNING || status === MeterSessionStatus.PAUSED) {
    return { idempotent: false };
  }
  if (status === MeterSessionStatus.STOPPED || status === MeterSessionStatus.FINALIZED) {
    return { idempotent: true };
  }
  throw new MeterError('METER_NOT_STARTED', 'Start the meter before stopping it.', 409);
}

export function assertCanPause(status: MeterSessionStatusType): { idempotent: boolean } {
  if (status === MeterSessionStatus.RUNNING) return { idempotent: false };
  if (status === MeterSessionStatus.PAUSED) return { idempotent: true };
  throw new MeterError('METER_NOT_PAUSABLE', 'Only a running meter can be paused.', 409);
}

export function assertCanResume(status: MeterSessionStatusType): { idempotent: boolean } {
  if (status === MeterSessionStatus.PAUSED) return { idempotent: false };
  if (status === MeterSessionStatus.RUNNING) return { idempotent: true };
  throw new MeterError('METER_NOT_RESUMABLE', 'Only a paused meter can be resumed.', 409);
}

/**
 * In-process lock so concurrent stop/finalize calls for one session run one
 * at a time. The database row lock is the cross-process guarantee.
 */
export class KeyedMutex {
  private tail = new Map<string, Promise<void>>();

  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.tail.get(key) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.tail.set(
      key,
      previous.then(() => current)
    );
    await previous;
    try {
      return await fn();
    } finally {
      release();
    }
  }
}
