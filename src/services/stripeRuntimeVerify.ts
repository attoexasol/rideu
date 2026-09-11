/**
 * Safe Stripe platform identity + Connect create probe.
 * Compare runtime paths without logging secrets.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import type Stripe from 'stripe';
import {
  classifyStripeSecretMode,
  getStripeConnectDefaultCountry,
  getStripeSecretKey,
  isStripeSecretConfigured,
} from '../config/stripe';
import { getStripeClient, resetStripeClientForTests } from './stripe.service';
import { buildDriverStripeAccountCreateIdempotencyKey } from '../constants/stripeConnect';

const VERIFY_PREFIX = '[STRIPE_RUNTIME_VERIFY]';

export type StripeRuntimeVerifySource =
  | 'backend'
  | 'debug-script'
  | 'verify-script'
  | 'http-endpoint';

export type StripePlatformSnapshot = {
  platformAccountId: string | null;
  country: string | null;
  chargesEnabled: boolean | null;
  payoutsEnabled: boolean | null;
  controllerFeesPayer: string | null;
  controllerLossesPayments: string | null;
};

export type StripeRuntimeEnvSnapshot = {
  envFilePath: string;
  envFileExists: boolean;
  dotenvOverride: false;
  shellStripeSecretPresent: boolean;
  envFileSecretFingerprint: string | null;
  stripeSecretPresent: boolean;
  stripeSecretMode: ReturnType<typeof classifyStripeSecretMode>;
  secretFingerprint: string | null;
  secretMatchesEnvFile: boolean | null;
  configuredCountry: string | null;
  apiVersion: string | null;
};

export type StripeConnectCreateProbe = {
  result: 'success' | 'failed';
  connectedAccountId: string | null;
  stripeRequestId: string | null;
  stripeErrorMessage: string | null;
  idempotencyKey?: string;
};

export const V1_VERIFY_PREFIX = '[STRIPE_V1_VERIFY]';

export function buildFreshAccountsV1IdempotencyKey(): string {
  return `verify:accounts-v1:${crypto.randomUUID()}`;
}

export function buildFreshAccountsV1ProbeDriverId(): string {
  return `verify-probe-${crypto.randomUUID()}`;
}

export function logStripeV1VerifyProbe(
  platformAccountId: string | null,
  probe: StripeConnectCreateProbe
): void {
  console.info(`${V1_VERIFY_PREFIX} platformAccountId=${platformAccountId ?? 'null'}`);
  console.info(`${V1_VERIFY_PREFIX} idempotencyKeyFresh=true`);
  if (probe.idempotencyKey) {
    console.info(`${V1_VERIFY_PREFIX} idempotencyKey=${probe.idempotencyKey}`);
  }
  console.info(`${V1_VERIFY_PREFIX} accountsCreateResult=${probe.result}`);
  if (probe.stripeErrorMessage) {
    console.info(`${V1_VERIFY_PREFIX} stripeErrorMessage=${probe.stripeErrorMessage}`);
  }
  console.info(`${V1_VERIFY_PREFIX} stripeRequestId=${probe.stripeRequestId ?? 'null'}`);
  if (probe.connectedAccountId) {
    console.info(`${V1_VERIFY_PREFIX} connectedAccountId=${probe.connectedAccountId}`);
  }
}

export async function probeStripeConnectAccountCreate(
  stripe: Stripe,
  driverId: string,
  country: string,
  idempotencyKey = buildDriverStripeAccountCreateIdempotencyKey(driverId)
): Promise<StripeConnectCreateProbe> {
  try {
    const account = await stripe.accounts.create(
      buildStripeConnectAccountCreateParams(driverId, country),
      { idempotencyKey }
    );
    return {
      result: 'success',
      connectedAccountId: account.id,
      stripeRequestId: null,
      stripeErrorMessage: null,
      idempotencyKey,
    };
  } catch (error) {
    const err = error as Stripe.errors.StripeError;
    return {
      result: 'failed',
      connectedAccountId: null,
      stripeRequestId: err.requestId ?? null,
      stripeErrorMessage: err.message ?? String(error),
      idempotencyKey,
    };
  }
}

function fingerprintSecret(secret: string | undefined): string | null {
  if (!secret) return null;
  return crypto.createHash('sha256').update(secret).digest('hex').slice(0, 12);
}

function readEnvFileSecretFingerprint(envFilePath: string): string | null {
  if (!fs.existsSync(envFilePath)) return null;
  const parsed = dotenv.parse(fs.readFileSync(envFilePath));
  return fingerprintSecret(parsed.STRIPE_SECRET_KEY?.trim());
}

export function describeStripeRuntimeEnv(
  shellStripeSecretPresent: boolean,
  envFilePath = '.env'
): StripeRuntimeEnvSnapshot {
  const resolvedEnvPath = path.resolve(process.cwd(), envFilePath);
  const secret = getStripeSecretKey();
  const activeFingerprint = fingerprintSecret(secret);
  const envFileFingerprint = readEnvFileSecretFingerprint(resolvedEnvPath);
  return {
    envFilePath: resolvedEnvPath,
    envFileExists: fs.existsSync(resolvedEnvPath),
    dotenvOverride: false,
    shellStripeSecretPresent,
    envFileSecretFingerprint: envFileFingerprint,
    stripeSecretPresent: isStripeSecretConfigured(),
    stripeSecretMode: classifyStripeSecretMode(secret),
    secretFingerprint: activeFingerprint,
    secretMatchesEnvFile:
      activeFingerprint && envFileFingerprint
        ? activeFingerprint === envFileFingerprint
        : null,
    configuredCountry: getStripeConnectDefaultCountry() ?? null,
    apiVersion: null,
  };
}

export async function retrieveStripePlatformSnapshot(
  stripe: Stripe
): Promise<StripePlatformSnapshot> {
  const account = await stripe.accounts.retrieve(null);
  const controller = account.controller;
  return {
    platformAccountId: account.id ?? null,
    country: account.country ?? null,
    chargesEnabled: account.charges_enabled ?? null,
    payoutsEnabled: account.payouts_enabled ?? null,
    controllerFeesPayer: controller?.fees?.payer ?? null,
    controllerLossesPayments: controller?.losses?.payments ?? null,
  };
}

export function buildStripeConnectAccountCreateParams(
  driverId: string,
  country: string
): Stripe.AccountCreateParams {
  return {
    country,
    business_type: 'individual',
    controller: {
      fees: { payer: 'application' },
      losses: { payments: 'application' },
      requirement_collection: 'stripe',
      stripe_dashboard: { type: 'express' },
    },
    capabilities: {
      transfers: { requested: true },
    },
    metadata: {
      driverId,
    },
  };
}

export function logStripeRuntimeEnv(source: StripeRuntimeVerifySource, env: StripeRuntimeEnvSnapshot): void {
  console.info(`${VERIFY_PREFIX} source=${source}`);
  console.info(`${VERIFY_PREFIX} envFilePath=${env.envFilePath}`);
  console.info(`${VERIFY_PREFIX} envFileExists=${env.envFileExists}`);
  console.info(`${VERIFY_PREFIX} dotenvOverride=${env.dotenvOverride}`);
  console.info(`${VERIFY_PREFIX} shellStripeSecretPresent=${env.shellStripeSecretPresent}`);
  console.info(`${VERIFY_PREFIX} stripeSecretPresent=${env.stripeSecretPresent}`);
  console.info(`${VERIFY_PREFIX} mode=${env.stripeSecretMode}`);
  console.info(`${VERIFY_PREFIX} secretFingerprint=${env.secretFingerprint ?? 'null'}`);
  console.info(
    `${VERIFY_PREFIX} envFileSecretFingerprint=${env.envFileSecretFingerprint ?? 'null'}`
  );
  console.info(`${VERIFY_PREFIX} secretMatchesEnvFile=${env.secretMatchesEnvFile ?? 'null'}`);
  console.info(`${VERIFY_PREFIX} configuredCountry=${env.configuredCountry ?? 'MISSING'}`);
  console.info(`${VERIFY_PREFIX} apiVersion=${env.apiVersion ?? 'stripe-sdk-default'}`);
}

export function logStripePlatformSnapshot(
  source: StripeRuntimeVerifySource,
  snapshot: StripePlatformSnapshot
): void {
  console.info(`${VERIFY_PREFIX} source=${source}`);
  console.info(`${VERIFY_PREFIX} platformAccountId=${snapshot.platformAccountId ?? 'null'}`);
  console.info(`${VERIFY_PREFIX} country=${snapshot.country ?? 'null'}`);
  console.info(`${VERIFY_PREFIX} chargesEnabled=${snapshot.chargesEnabled ?? 'null'}`);
  console.info(`${VERIFY_PREFIX} payoutsEnabled=${snapshot.payoutsEnabled ?? 'null'}`);
  console.info(
    `${VERIFY_PREFIX} controllerFeesPayer=${snapshot.controllerFeesPayer ?? 'null'}`
  );
  console.info(
    `${VERIFY_PREFIX} controllerLossesPayments=${snapshot.controllerLossesPayments ?? 'null'}`
  );
}

export function logStripeConnectCreateProbe(
  source: StripeRuntimeVerifySource,
  probe: StripeConnectCreateProbe
): void {
  console.info(`${VERIFY_PREFIX} source=${source}`);
  console.info(`${VERIFY_PREFIX} accountsCreateResult=${probe.result}`);
  console.info(`${VERIFY_PREFIX} connectedAccountId=${probe.connectedAccountId ?? 'null'}`);
  console.info(`${VERIFY_PREFIX} stripeRequestId=${probe.stripeRequestId ?? 'null'}`);
  if (probe.stripeErrorMessage) {
    console.info(`${VERIFY_PREFIX} stripeErrorMessage=${probe.stripeErrorMessage}`);
  }
}

/** Backend path uses the shared lazy Stripe client. */
export async function verifyBackendStripeRuntime(
  shellStripeSecretPresent: boolean,
  driverId: string
): Promise<{
  env: StripeRuntimeEnvSnapshot;
  platform: StripePlatformSnapshot;
  probe: StripeConnectCreateProbe;
}> {
  resetStripeClientForTests();
  const env = describeStripeRuntimeEnv(shellStripeSecretPresent);
  const stripe = getStripeClient();
  const country = env.configuredCountry ?? 'US';
  const platform = await retrieveStripePlatformSnapshot(stripe);
  const probe = await probeStripeConnectAccountCreate(stripe, driverId, country);
  return { env, platform, probe };
}

export { resetStripeClientForTests, VERIFY_PREFIX };
