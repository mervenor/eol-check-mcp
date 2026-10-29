/**
 * Finds and loads the snapshot. Order of preference:
 *  1. the file named by EOL_CHECK_SNAPSHOT, if set;
 *  2. the refreshed copy in the user cache, if it is valid and not older than the bundled one;
 *  3. the snapshot bundled with the package (data/snapshot.json).
 */
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isIsoDate } from './dates.js';
import type { Snapshot } from './types.js';

export const BUNDLED_SNAPSHOT_PATH = fileURLToPath(new URL('../data/snapshot.json', import.meta.url));

export type SnapshotOrigin = 'env' | 'cache' | 'bundled';

export interface LoadedSnapshot {
  snapshot: Snapshot;
  path: string;
  origin: SnapshotOrigin;
}

export function defaultCachePath(env: NodeJS.ProcessEnv = process.env): string {
  const base =
    env.XDG_CACHE_HOME ||
    (process.platform === 'win32' ? env.LOCALAPPDATA : undefined) ||
    path.join(os.homedir(), '.cache');
  return path.join(base, 'eol-check-mcp', 'snapshot.json');
}

export function validateSnapshot(value: unknown, where: string): Snapshot {
  const s = value as Partial<Snapshot> | null;
  if (!s || typeof s !== 'object') throw new Error(`${where}: not a JSON object.`);
  if (s.schemaVersion !== 1) throw new Error(`${where}: unsupported schemaVersion ${String(s.schemaVersion)}.`);
  if (!isIsoDate(s.dataDate)) throw new Error(`${where}: missing or invalid dataDate.`);
  if (!Array.isArray(s.products) || s.products.length === 0) throw new Error(`${where}: no products.`);
  for (const p of s.products) {
    if (!p || typeof p.name !== 'string' || !Array.isArray(p.releases)) {
      throw new Error(`${where}: malformed product entry.`);
    }
  }
  return s as Snapshot;
}

export function readSnapshotFile(file: string): Snapshot {
  const text = readFileSync(file, 'utf8');
  return validateSnapshot(JSON.parse(text), file);
}

export function loadSnapshot(env: NodeJS.ProcessEnv = process.env): LoadedSnapshot {
  const explicit = env.EOL_CHECK_SNAPSHOT;
  if (explicit) {
    return { snapshot: readSnapshotFile(explicit), path: explicit, origin: 'env' };
  }

  const bundled = readSnapshotFile(BUNDLED_SNAPSHOT_PATH);
  const cachePath = defaultCachePath(env);
  if (existsSync(cachePath)) {
    try {
      const cached = readSnapshotFile(cachePath);
      if (cached.dataDate >= bundled.dataDate) {
        return { snapshot: cached, path: cachePath, origin: 'cache' };
      }
    } catch {
      // A broken cache must never stop the server: fall back to the bundled data.
    }
  }
  return { snapshot: bundled, path: BUNDLED_SNAPSHOT_PATH, origin: 'bundled' };
}
