import { requireOptionalNativeModule } from 'expo';
import type { WearableHealthNativeModule } from './WearableHealth.types.ts';

export function getWearableHealthNativeModule(): WearableHealthNativeModule | null {
  return requireOptionalNativeModule<WearableHealthNativeModule>('WearableHealth');
}
