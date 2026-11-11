export type M3RuntimeMode = 'off' | 'fixture' | 'live' | 'local-verification';

export function resolveM3RuntimeMode(value: string | undefined): M3RuntimeMode {
  return value === 'local-verification' || value === 'fixture' || value === 'live' || value === 'off' ? value : 'off';
}

export function selectM3RuntimeAdapter<T>(
  mode: M3RuntimeMode,
  target: Exclude<M3RuntimeMode, 'off'>,
  createAdapter: () => T,
): T | undefined {
  return mode === target ? createAdapter() : undefined;
}
