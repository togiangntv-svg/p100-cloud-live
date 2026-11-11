import * as FileSystem from 'expo-file-system/legacy';
import type { OwnedCacheCleanupPort } from './expo-image-preparer.ts';

type CacheFileSystem = Readonly<{
  cacheDirectory: string | null | undefined;
  getInfoAsync(uri: string): Promise<Readonly<{ exists: boolean; isDirectory?: boolean }>>;
  deleteAsync(uri: string, options: Readonly<{ idempotent: true }>): Promise<void>;
}>;

/** Parse an absolute local file URI without normalizing an unsafe path first. */
function fileSegments(uri: unknown): string[] | undefined {
  if (typeof uri !== 'string' || !uri.startsWith('file:///')
    || /[?#\\\u0000-\u001f\u007f]/u.test(uri)) return undefined;
  const raw = uri.slice('file:///'.length);
  if (!raw) return undefined;
  const parts = raw.endsWith('/') ? raw.slice(0, -1).split('/') : raw.split('/');
  if (parts.some(part => !part)) return undefined;
  try {
    const decoded = parts.map(part => decodeURIComponent(part));
    if (decoded.some(part => part === '.' || part === '..'
      || /[/%\\\u0000-\u001f\u007f]/u.test(part))) return undefined;
    return decoded;
  } catch { return undefined; }
}

function isChildCacheJpeg(cacheDirectory: unknown, uri: unknown): uri is string {
  if (typeof uri !== 'string' || uri.endsWith('/')) return false;
  const cache = fileSegments(cacheDirectory);
  const target = fileSegments(uri);
  return Boolean(cache && target && target.length > cache.length
    && cache.every((segment, index) => target[index] === segment)
    && /\.jpe?g$/iu.test(target[target.length - 1]));
}

/** Trusted C2 composition passes this port only to its private saveAsync artifact lifecycle. */
export function createExpoCacheCleanup(
  filesystem: CacheFileSystem = FileSystem,
): OwnedCacheCleanupPort {
  return Object.freeze({
    canDeleteOwnedCache: (uri?: string): boolean => {
      try {
        return uri === undefined
          ? Boolean(fileSegments(filesystem.cacheDirectory))
          : isChildCacheJpeg(filesystem.cacheDirectory, uri);
      } catch { return false; }
    },
    deleteOwnedCache: async (uri: string): Promise<boolean> => {
      try {
        if (!isChildCacheJpeg(filesystem.cacheDirectory, uri)) return false;
        const info = await filesystem.getInfoAsync(uri);
        if (info.exists === false) return true; // Already absent; no delete is needed.
        if (info.exists !== true || info.isDirectory !== false) return false;
        await filesystem.deleteAsync(uri, { idempotent: true });
        return true; // The target is absent after the idempotent operation.
      } catch { return false; }
    },
  });
}
