import { isLocalVerificationAdapter, localVerificationAdapterCurrent } from './local-verification-adapter';
type M3HostAdapter = Readonly<{ processing: 'ON_DEVICE' | 'EXTERNAL' }>;
type M3ExternalAccess = Readonly<{
  status: 'allowed' | 'denied' | 'unknown';
  revision: number;
}>;

export type M3HostPermission = Readonly<{
  mode: 'off' | 'stub' | 'live';
  taskPermissionGranted: boolean;
  permissionRevision: number | undefined;
  showExternalPermissionNotice: boolean;
}>;

/**
 * External-AI consent applies only to adapters that send content outside the
 * device. Deterministic ON_DEVICE fixtures stay local and therefore do not
 * borrow, require, or mutate that consent.
 */
export function resolveM3HostPermission(
  adapter: M3HostAdapter | undefined,
  access: M3ExternalAccess | undefined,
): M3HostPermission {
  if (!adapter) return Object.freeze({
    mode: 'off',
    taskPermissionGranted: false,
    permissionRevision: access?.revision,
    showExternalPermissionNotice: false,
  });
  if (isLocalVerificationAdapter(adapter)) return Object.freeze({
    mode: 'stub', taskPermissionGranted: localVerificationAdapterCurrent(adapter) && access?.status === 'allowed',
    permissionRevision: access?.revision, showExternalPermissionNotice: false,
  });
  if (adapter.processing === 'ON_DEVICE') return Object.freeze({
    mode: 'stub',
    taskPermissionGranted: true,
    permissionRevision: undefined,
    showExternalPermissionNotice: false,
  });
  const allowed = access?.status === 'allowed';
  return Object.freeze({
    mode: 'live',
    taskPermissionGranted: allowed,
    permissionRevision: access?.revision,
    showExternalPermissionNotice: !allowed,
  });
}
