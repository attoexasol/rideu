import type { App, ServiceAccount } from 'firebase-admin/app';
import {
  getFirebaseProjectId,
  getFirebaseServiceAccountJson,
  getGoogleApplicationCredentialsPath,
  hasFcmCredentialConfig,
  isFcmEnabled,
} from '../config/fcm';
import { logger } from '../middleware/logger';

type MessagingSend = (message: unknown) => Promise<string>;

let initAttempted = false;
let initWarningLogged = false;
let firebaseApp: App | null = null;
let messagingSend: MessagingSend | null = null;

function logFcmConfigWarning(reason: string): void {
  if (initWarningLogged) return;
  initWarningLogged = true;
  logger.warn({
    event: 'fcm.config.unavailable',
    fcmEnabled: isFcmEnabled(),
    credentialsConfigured: hasFcmCredentialConfig(),
    reason,
  });
}

function parseServiceAccount(): ServiceAccount | null {
  const raw = getFirebaseServiceAccountJson();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ServiceAccount;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    logFcmConfigWarning('FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON');
    return null;
  }
}

async function initializeFirebaseAdmin(): Promise<boolean> {
  if (firebaseApp && messagingSend) return true;
  if (initAttempted) return Boolean(firebaseApp && messagingSend);
  initAttempted = true;

  if (!isFcmEnabled()) {
    logFcmConfigWarning('FCM_ENABLED is false; offer push is a no-op');
    return false;
  }

  if (!hasFcmCredentialConfig()) {
    logFcmConfigWarning(
      'FCM_ENABLED is true but no Firebase credentials are configured (set GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_SERVICE_ACCOUNT_JSON)'
    );
    return false;
  }

  try {
    const adminApp = await import('firebase-admin/app');
    const adminMessaging = await import('firebase-admin/messaging');

    if (adminApp.getApps().length > 0) {
      firebaseApp = adminApp.getApp();
    } else {
      const serviceAccount = parseServiceAccount();
      const projectId = getFirebaseProjectId();
      if (serviceAccount) {
        firebaseApp = adminApp.initializeApp({
          credential: adminApp.cert(serviceAccount),
          projectId: projectId || (serviceAccount as { project_id?: string }).project_id,
        });
      } else if (getGoogleApplicationCredentialsPath()) {
        firebaseApp = adminApp.initializeApp({
          credential: adminApp.applicationDefault(),
          projectId,
        });
      } else {
        logFcmConfigWarning('Firebase credentials could not be loaded');
        return false;
      }
    }

    const messaging = adminMessaging.getMessaging(firebaseApp);
    messagingSend = (message) => messaging.send(message as Parameters<typeof messaging.send>[0]);
    logger.info({
      event: 'fcm.initialized',
      projectConfigured: Boolean(getFirebaseProjectId()),
      credentialMode: getFirebaseServiceAccountJson()
        ? 'FIREBASE_SERVICE_ACCOUNT_JSON'
        : 'GOOGLE_APPLICATION_CREDENTIALS',
    });
    return true;
  } catch (error) {
    firebaseApp = null;
    messagingSend = null;
    logger.warn({
      event: 'fcm.init.failed',
      reason: error instanceof Error ? error.message : 'unknown',
    });
    return false;
  }
}

export function logFcmStartupState(): void {
  void isFcmReady();
}

export async function isFcmReady(): Promise<boolean> {
  if (!isFcmEnabled()) {
    logFcmConfigWarning('FCM_ENABLED is false; offer push is a no-op');
    return false;
  }
  return initializeFirebaseAdmin();
}

export async function sendFcmMessage(message: unknown): Promise<string> {
  const ready = await initializeFirebaseAdmin();
  if (!ready || !messagingSend) {
    const err = new Error('FCM_UNAVAILABLE') as Error & { code: string };
    err.code = 'FCM_UNAVAILABLE';
    throw err;
  }
  return messagingSend(message);
}

/** Test-only: reset lazy init cache. */
export function resetFcmAdminForTests(): void {
  initAttempted = false;
  initWarningLogged = false;
  firebaseApp = null;
  messagingSend = null;
}
