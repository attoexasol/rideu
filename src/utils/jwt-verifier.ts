/**
 * Shared JWT verification utility
 *
 * Verifies Auth0 RS256 access tokens via JWKS and backend HS256 session tokens.
 * Used by Express middleware, login route, and Socket.IO authentication.
 */

import { createRemoteJWKSet, jwtVerify, JWTPayload } from 'jose';
import jwt from 'jsonwebtoken';
import { auth0Config } from '../config/auth0';

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

const getJWKS = () => {
  if (!jwks && auth0Config.jwksUri) {
    jwks = createRemoteJWKSet(new URL(auth0Config.jwksUri));
  }
  return jwks;
};

export const isAuth0Configured = (): boolean =>
  Boolean(auth0Config.domain && auth0Config.jwksUri && auth0Config.issuer);

/**
 * Verify an Auth0 RS256 access token against JWKS.
 * Validates issuer, audience, and algorithm.
 */
export async function verifyAuth0Token(token: string): Promise<JWTPayload> {
  if (!isAuth0Configured()) {
    throw new Error('Auth0 is not configured');
  }

  const jwksSet = getJWKS();
  if (!jwksSet) {
    throw new Error('Auth0 JWKS endpoint is not configured');
  }

  const { payload } = await jwtVerify(token, jwksSet, {
    issuer: auth0Config.issuer,
    audience: auth0Config.audience,
    algorithms: [auth0Config.tokenSigningAlg],
  });

  return payload;
}

/**
 * Verify a backend HS256 session token issued by /api/auth/login.
 */
export function verifySessionToken(token: string): jwt.JwtPayload {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is not configured');
  }

  return jwt.verify(token, secret, { algorithms: ['HS256'] }) as jwt.JwtPayload;
}

/**
 * Detect token algorithm from JWT header (no signature check).
 */
function getTokenAlgorithm(token: string): string | undefined {
  const decoded = jwt.decode(token, { complete: true });
  return decoded?.header?.alg;
}

/**
 * Verify a Bearer token — Auth0 RS256 or backend HS256 session JWT.
 * Preserves existing login/session flow while enforcing Auth0 verification.
 */
export async function verifyBearerToken(token: string): Promise<Record<string, unknown>> {
  const algorithm = getTokenAlgorithm(token);

  if (algorithm === 'HS256') {
    return verifySessionToken(token) as Record<string, unknown>;
  }

  if (isAuth0Configured()) {
    try {
      const payload = await verifyAuth0Token(token);
      return payload as Record<string, unknown>;
    } catch (auth0Error) {
      // Session tokens may omit alg in edge cases; try HS256 fallback
      if (process.env.JWT_SECRET) {
        try {
          return verifySessionToken(token) as Record<string, unknown>;
        } catch {
          // fall through to Auth0 error
        }
      }
      throw auth0Error;
    }
  }

  if (process.env.JWT_SECRET) {
    return verifySessionToken(token) as Record<string, unknown>;
  }

  throw new Error('No JWT verification method configured');
}
