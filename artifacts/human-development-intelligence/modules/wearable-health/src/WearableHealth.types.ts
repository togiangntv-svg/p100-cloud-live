import type {WearableWireAuthority} from '../../../domain/wearable/contract.ts';
export type NativeHealthReadState =
  | 'AVAILABLE'
  | 'NO_DATA'
  | 'PERMISSION_DENIED'
  | 'PLATFORM_UNAVAILABLE'
  | 'HEALTH_LIVE_OFF'
  | 'DISCARDED_STALE_EPOCH'
  | 'OUTSIDE_V1_RECENT_CONTEXT';

export type NativeHealthAuthorizationResult = Readonly<{
  state: 'REQUEST_COMPLETED' | 'PLATFORM_UNAVAILABLE' | 'HEALTH_LIVE_OFF' | 'DISCARDED_STALE_EPOCH';
}>;

export type NativeStepsReadResult =
  | Readonly<{
    state: 'AVAILABLE';
    count: number;
    observedStartedAt: string;
    observedEndedAt: string;
    dataOrigins?: readonly string[];
  }>
  | Readonly<{ state: Exclude<NativeHealthReadState,'AVAILABLE'> }>;

export type NativeWorkoutCategory =
  | 'GENERAL'
  | 'WALK'
  | 'RUN'
  | 'CYCLE'
  | 'STRENGTH'
  | 'OTHER';

export type NativeWorkout = Readonly<{
  category: NativeWorkoutCategory;
  startedAt: string;
  endedAt: string;
  durationMinutes: number;
}>;

export type NativeWorkoutsReadResult =
  | Readonly<{ state: 'AVAILABLE'; workouts: readonly NativeWorkout[] }>
  | Readonly<{ state: Exclude<NativeHealthReadState,'AVAILABLE'> }>;

export type WearableHealthNativeModule = Readonly<{
  isAvailable(): boolean;
  clearSession(): void;
  requestReadAccess(authority:WearableWireAuthority): Promise<NativeHealthAuthorizationResult>;
  readSteps(startedAt: string, endedAt: string, authority:WearableWireAuthority): Promise<NativeStepsReadResult>;
  readWorkouts(startedAt: string, endedAt: string, authority:WearableWireAuthority): Promise<NativeWorkoutsReadResult>;
}>;
