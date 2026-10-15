import { lstat, readdir, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';

export const DEFAULT_MAP_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const DEFAULT_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
export const GENERATED_MAP_FILENAME = /^period_map_[0-9a-f]{32}\.png$/;

export function configuredRetentionMs(value = process.env.MAP_RETENTION_DAYS): number {
  if (value === undefined) return DEFAULT_MAP_RETENTION_MS;
  const milliseconds = Number(value) * 24 * 60 * 60 * 1000;
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) {
    throw new Error('MAP_RETENTION_DAYS must be a positive number');
  }
  return milliseconds;
}

export function validateRetentionMs(value: number): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error('Map retention must be a positive duration');
  return value;
}

// Completed UUID images are immutable. Hidden writes, demos, legacy latest files,
// symlinks and directories are never eligible for deletion.
export async function removeExpiredMap(outputDir: string, filename: string, retentionMs: number, now = Date.now()): Promise<boolean> {
  if (!GENERATED_MAP_FILENAME.test(filename)) return false;
  const path = resolve(outputDir, filename);
  try {
    const info = await lstat(path);
    if (!info.isFile() || now - info.mtimeMs < retentionMs) return false;
    await unlink(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

export async function cleanupGeneratedMaps(outputDir: string, retentionMs = DEFAULT_MAP_RETENTION_MS, now = Date.now()): Promise<number> {
  validateRetentionMs(retentionMs);
  let filenames: string[];
  try { filenames = await readdir(outputDir); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    throw error;
  }
  let removed = 0;
  for (const filename of filenames) {
    if (await removeExpiredMap(outputDir, filename, retentionMs, now)) removed++;
  }
  return removed;
}
