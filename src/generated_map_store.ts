import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { cleanupGeneratedMaps, GENERATED_MAP_FILENAME } from './output_retention.js';
import { HttpError } from './server_policy.js';

export const DEFAULT_MAP_STORAGE_BYTES = 512 * 1024 * 1024;
export const DEFAULT_MAP_MAX_BYTES = 16 * 1024 * 1024;

/** One shared instance per server. Reservations include in-flight renders, and
 * serialization makes admission and writes atomic relative to other requests. */
export class GeneratedMapStore {
  private reserved = 0;
  private pending: Promise<unknown> = Promise.resolve();
  constructor(private readonly dir: string, private readonly budget: number, private readonly maxImageBytes: number, private readonly retentionMs: number) {}

  private async exclusive<T>(run: () => Promise<T>): Promise<T> {
    const previous = this.pending;
    let release!: () => void;
    this.pending = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try { return await run(); }
    finally { release(); }
  }

  private async bytesUsed(): Promise<number> {
    let total = 0;
    const entries = await readdir(this.dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !GENERATED_MAP_FILENAME.test(entry.name)) continue;
      try {
        const info = await lstat(resolve(this.dir, entry.name));
        if (info.isFile()) total += info.size;
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    return total;
  }

  async reserve(): Promise<{ write: (bytes: Buffer, signal?: AbortSignal) => Promise<string>; release: () => void }> {
    await this.exclusive(async () => {
      await mkdir(this.dir, { recursive: true });
      await cleanupGeneratedMaps(this.dir, this.retentionMs);
      if (await this.bytesUsed() + this.reserved + this.maxImageBytes > this.budget) {
        throw new HttpError(503, 'Map storage is full. Please try again later.', 60);
      }
      this.reserved += this.maxImageBytes;
    });
    let released = false;
    let written = false;
    const release = () => { if (!released) { released = true; this.reserved -= this.maxImageBytes; } };
    return {
      release,
      write: async (bytes, signal) => this.exclusive(async () => {
        if (released || written) throw new Error('Map reservation is no longer available');
        if (signal?.aborted) throw new HttpError(503, 'Map request was cancelled');
        if (bytes.length > this.maxImageBytes) throw new HttpError(503, 'Generated map exceeds the image size limit');
        // Recheck actual directory contents in case another process or operator
        // has written into it since admission; never evict a valid older map.
        if (await this.bytesUsed() + this.reserved > this.budget) throw new HttpError(503, 'Map storage is full. Please try again later.', 60);
        const filename = `period_map_${randomUUID().replaceAll('-', '')}.png`;
        const temporary = resolve(this.dir, `.${filename}.tmp`);
        try {
          await writeFile(temporary, bytes, { flag: 'wx' });
          if (signal?.aborted) throw new HttpError(503, 'Map request was cancelled');
          await rename(temporary, resolve(this.dir, filename));
          written = true;
          release();
          return filename;
        } finally { await rm(temporary, { force: true }); }
      }),
    };
  }
}
