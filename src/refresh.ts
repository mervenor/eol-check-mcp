/**
 * Downloads fresh endoflife.date data and writes a snapshot.
 *  - "api": the public API (https://endoflife.date/api/v1/products/full).
 *  - "git": a shallow clone of the endoflife-date/endoflife.date repository, reading the YAML
 *    front matter of products/*.md (needs the git command line tool).
 *  - "auto" (default): the API, then Git if the API cannot be reached.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  API_FULL_URL,
  DATA_REPOSITORY,
  serialiseSnapshot,
  snapshotFromApi,
  snapshotFromFrontMatter,
  type ApiFullResponse,
} from './snapshot-transform.js';
import { validateSnapshot } from './data.js';
import type { Snapshot } from './types.js';

export type RefreshSource = 'auto' | 'api' | 'git';

export interface RefreshOptions {
  source?: RefreshSource;
  out: string;
  /** Use an existing clone instead of cloning (git source only). */
  gitDir?: string;
  apiUrl?: string;
  timeoutMs?: number;
  log?: (message: string) => void;
}

export interface RefreshResult {
  snapshot: Snapshot;
  out: string;
  warnings: string[];
}

const GIT_URL = `${DATA_REPOSITORY}.git`;

function git(args: string[], cwd?: string, timeoutMs = 120_000): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', timeout: timeoutMs, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function headOf(dir: string): { commit: string; commitDate: string } {
  const [commit = '', commitDate = ''] = git(['log', '-1', '--format=%H %cI'], dir).split(' ');
  return { commit, commitDate };
}

function shallowClone(target: string, withFiles: boolean): void {
  const args = ['clone', '--quiet', '--depth', '1'];
  if (!withFiles) args.push('--filter=blob:none', '--no-checkout');
  git([...args, GIT_URL, target]);
}

/** The commit the upstream repository was at, without downloading file contents. Best effort. */
export function upstreamHead(log: (m: string) => void = () => {}): { commit?: string; commitDate?: string } {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'eol-check-head-'));
  try {
    shallowClone(path.join(tmp, 'repo'), false);
    return headOf(path.join(tmp, 'repo'));
  } catch (err) {
    log(`Could not read the upstream commit: ${(err as Error).message.split('\n')[0]}`);
    return {};
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

export async function snapshotFromApiUrl(url = API_FULL_URL, timeoutMs = 60_000): Promise<{ snapshot: Snapshot }> {
  const res = await fetch(url, {
    headers: { accept: 'application/json', 'user-agent': 'eol-check-mcp (+https://github.com/mervenor/eol-check-mcp)' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`API answered ${res.status} ${res.statusText}`);
  const body = (await res.json()) as ApiFullResponse;
  const generated = body.generated_at ?? new Date().toISOString();
  return { snapshot: snapshotFromApi(body, { dataDate: generated.slice(0, 10), apiUrl: url }) };
}

export function snapshotFromGitDir(dir: string): { snapshot: Snapshot; errors: string[] } {
  const productsDir = path.join(dir, 'products');
  const files = readdirSync(productsDir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((fileName) => ({ fileName, content: readFileSync(path.join(productsDir, fileName), 'utf8') }));
  const { commit, commitDate } = headOf(dir);
  const dataDate = new Date(commitDate).toISOString().slice(0, 10);
  return snapshotFromFrontMatter(files, { dataDate, commit, commitDate });
}

export function writeSnapshot(snapshot: Snapshot, out: string): void {
  validateSnapshot(snapshot, 'new snapshot');
  mkdirSync(path.dirname(out), { recursive: true });
  const tmp = `${out}.tmp-${process.pid}`;
  writeFileSync(tmp, serialiseSnapshot(snapshot), 'utf8');
  renameSync(tmp, out);
}

export async function refreshSnapshot(options: RefreshOptions): Promise<RefreshResult> {
  const log = options.log ?? (() => {});
  const source = options.source ?? 'auto';
  const warnings: string[] = [];
  let snapshot: Snapshot | undefined;

  if (source === 'api' || source === 'auto') {
    try {
      log(`Fetching ${options.apiUrl ?? API_FULL_URL} ...`);
      snapshot = (await snapshotFromApiUrl(options.apiUrl, options.timeoutMs)).snapshot;
      const head = upstreamHead(log);
      snapshot.source = { ...snapshot.source, ...head };
    } catch (err) {
      const msg = `API download failed: ${(err as Error).message}`;
      if (source === 'api') throw new Error(msg);
      warnings.push(msg);
      log(`${msg}. Falling back to the Git repository.`);
    }
  }

  if (!snapshot) {
    let dir = options.gitDir;
    let tmp: string | undefined;
    try {
      if (!dir) {
        tmp = mkdtempSync(path.join(os.tmpdir(), 'eol-check-git-'));
        dir = path.join(tmp, 'repo');
        log(`Cloning ${GIT_URL} ...`);
        shallowClone(dir, true);
      }
      const built = snapshotFromGitDir(dir);
      for (const e of built.errors) warnings.push(`Skipped ${e}`);
      snapshot = built.snapshot;
    } finally {
      if (tmp) rmSync(tmp, { recursive: true, force: true });
    }
  }

  writeSnapshot(snapshot, options.out);
  log(`Wrote ${snapshot.productCount} products (data date ${snapshot.dataDate}) to ${options.out}`);
  return { snapshot, out: options.out, warnings };
}
