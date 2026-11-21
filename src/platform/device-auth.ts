import { Capacitor, registerPlugin } from '@capacitor/core';
import { AppError } from '../core/errors';

const native = registerPlugin<{
  available(): Promise<{ supported: boolean }>;
  authenticate(): Promise<void>;
}>('DeviceAuth');

export function androidDeviceLock(): boolean { return Capacitor.getPlatform() === 'android'; }

export async function deviceAuthAvailable(): Promise<boolean> {
  if (!androidDeviceLock()) return false;
  return (await native.available()).supported;
}

/** Resolves only after OS authentication, never on a canceled prompt. */
export async function confirmDeviceIdentity(): Promise<void> {
  if (!androidDeviceLock()) throw new AppError('nativeRequired');
  if (!(await deviceAuthAvailable())) throw new AppError('authUnavailable');
  await native.authenticate();
}
