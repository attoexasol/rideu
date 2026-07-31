import { Auth0Roles } from '../config/auth0';

export interface AdminFleetScope {
  mode: 'all' | 'restricted';
  fleetIds: string[];
}

export interface AdminFleetUser {
  role?: string;
  permissions?: string[];
  fleetIds?: string[];
}

const FLEET_PERMISSION_PREFIX = 'fleet:';

export function extractFleetIdsFromUser(user: AdminFleetUser): string[] {
  if (Array.isArray(user.fleetIds) && user.fleetIds.length > 0) {
    return user.fleetIds.filter((id) => typeof id === 'string' && id.length > 0);
  }

  const permissions = user.permissions ?? [];
  return permissions
    .filter((p) => p.startsWith(FLEET_PERMISSION_PREFIX))
    .map((p) => p.slice(FLEET_PERMISSION_PREFIX.length))
    .filter((id) => id.length > 0);
}

export function resolveAdminFleetScope(user: AdminFleetUser): AdminFleetScope {
  const role = user.role?.toLowerCase();

  if (role === Auth0Roles.SUPER_ADMIN || role === Auth0Roles.ADMIN) {
    return { mode: 'all', fleetIds: [] };
  }

  if (role === 'fleet_manager') {
    return { mode: 'restricted', fleetIds: extractFleetIdsFromUser(user) };
  }

  return { mode: 'restricted', fleetIds: [] };
}

export function assertFleetAccess(scope: AdminFleetScope, fleetId?: string | null): void {
  if (!fleetId || scope.mode === 'all') return;

  if (!scope.fleetIds.length) {
    throw new AdminFleetAccessError('UNAUTHORIZED', 'No authorized fleets for this admin', 403);
  }

  if (!scope.fleetIds.includes(fleetId)) {
    throw new AdminFleetAccessError('UNAUTHORIZED', 'Fleet access denied', 403);
  }
}

export function fleetIdsForQuery(
  scope: AdminFleetScope,
  requestedFleetId?: string
): string[] | null {
  if (scope.mode === 'all') {
    return requestedFleetId ? [requestedFleetId] : null;
  }

  if (!scope.fleetIds.length) {
    throw new AdminFleetAccessError('UNAUTHORIZED', 'No authorized fleets for this admin', 403);
  }

  if (requestedFleetId) {
    if (!scope.fleetIds.includes(requestedFleetId)) {
      throw new AdminFleetAccessError('UNAUTHORIZED', 'Fleet access denied', 403);
    }
    return [requestedFleetId];
  }

  return scope.fleetIds;
}

export class AdminFleetAccessError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode = 403
  ) {
    super(message);
    this.name = 'AdminFleetAccessError';
  }
}
