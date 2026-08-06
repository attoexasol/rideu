/**
 * Ride-video admin permissions.
 *
 * Claim sources (first match wins):
 * 1. JWT `permissions` or `https://drivewize.com/permissions`
 * 2. Role fallback mapping (recommended until Auth0 scopes are assigned)
 */

export const RideVideoPermissions = {
  VIEW: 'ride_video.view',
  PLAY: 'ride_video.play',
  DOWNLOAD: 'ride_video.download',
  AUDIT: 'ride_video.audit',
  MANAGE: 'ride_video.manage',
  DELETE: 'ride_video.delete',
} as const;

export type RideVideoPermission =
  (typeof RideVideoPermissions)[keyof typeof RideVideoPermissions];

/** Role → default ride-video permissions when JWT has no explicit scopes. */
export const RIDE_VIDEO_ROLE_PERMISSIONS: Record<string, readonly RideVideoPermission[]> = {
  admin: [
    RideVideoPermissions.VIEW,
    RideVideoPermissions.PLAY,
    RideVideoPermissions.AUDIT,
  ],
  super_admin: [
    RideVideoPermissions.VIEW,
    RideVideoPermissions.PLAY,
    RideVideoPermissions.DOWNLOAD,
    RideVideoPermissions.AUDIT,
    RideVideoPermissions.MANAGE,
    RideVideoPermissions.DELETE,
  ],
};

export function resolveRideVideoPermissions(input: {
  role?: string | null;
  permissions?: unknown;
}): Set<RideVideoPermission> {
  const granted = new Set<RideVideoPermission>();
  const claimed = Array.isArray(input.permissions)
    ? input.permissions.filter((p): p is string => typeof p === 'string')
    : [];

  for (const permission of Object.values(RideVideoPermissions)) {
    if (claimed.includes(permission)) {
      granted.add(permission);
    }
  }

  // If Auth0 sent any ride_video.* scopes, treat them as authoritative.
  if (granted.size > 0) {
    return granted;
  }

  const role = (input.role || '').toLowerCase();
  const mapped = RIDE_VIDEO_ROLE_PERMISSIONS[role] || [];
  for (const permission of mapped) {
    granted.add(permission);
  }
  return granted;
}

export function hasRideVideoPermission(
  input: { role?: string | null; permissions?: unknown },
  required: RideVideoPermission
): boolean {
  return resolveRideVideoPermissions(input).has(required);
}
