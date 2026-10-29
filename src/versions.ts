/**
 * Maps a version string as people write it ("v18.17.0", "net8.0", "net472", "3.12-slim",
 * "lts/hydrogen", "jammy") to a release cycle of a product.
 */
import type { SnapshotProduct, SnapshotRelease } from './types.js';

/** Node.js LTS codenames (used in .nvmrc files and Docker tags). */
export const NODE_CODENAMES: Record<string, string> = {
  argon: '4',
  boron: '6',
  carbon: '8',
  dubnium: '10',
  erbium: '12',
  fermium: '14',
  gallium: '16',
  hydrogen: '18',
  iron: '20',
  jod: '22',
  krypton: '24',
};

/** Debian and Ubuntu codenames that appear as suffixes in Docker image tags. */
export const DEBIAN_CODENAMES: Record<string, string> = {
  jessie: '8',
  stretch: '9',
  buster: '10',
  bullseye: '11',
  bookworm: '12',
  trixie: '13',
};

export const UBUNTU_CODENAMES: Record<string, string> = {
  xenial: '16.04',
  bionic: '18.04',
  focal: '20.04',
  jammy: '22.04',
  noble: '24.04',
  resolute: '26.04',
};

/**
 * Turns a raw version as written in a file or question into something cycle matching can use.
 * Returns the cleaned string; product-specific notations are converted.
 */
export function normaliseVersion(product: string, raw: string): string {
  let v = raw.trim().toLowerCase();
  v = v.replace(/^(version|release|v\.)\s*/, '');

  if (product === 'dotnet') {
    // Target framework monikers first: net8.0, net8.0-windows, netcoreapp3.1
    const tfm = /^(?:net|netcoreapp)(\d+\.\d+)(?:-[a-z0-9.]+)?$/.exec(v);
    if (tfm?.[1]) return tfm[1];
    // Then product names: .NET 8, .NET Core 3.1, ASP.NET Core 8
    v = v.replace(/^(asp\.?net\s*core|\.?net\s*core|\.net|net)\s+/, '').replace(/^\.net(?=\d)/, '');
  }

  if (product === 'dotnetfx') {
    v = v.replace(/^(\.?net\s*framework|\.?net\s*fx)\s*/, '');
    // Compact monikers: net48 -> 4.8, net472 -> 4.7.2, net35 -> 3.5
    const tfm = /^net(\d)(\d)(\d)?$/.exec(v);
    if (tfm) return [tfm[1], tfm[2], tfm[3]].filter(Boolean).join('.');
    v = v.replace(/^v(?=\d)/, '');
    v = v.replace(/\s*sp\s*1$/, '-sp1');
  }

  if (product === 'nodejs') {
    v = v.replace(/^node(\.?js)?\s*/, '');
    const lts = /^lts[/-](\w+)/.exec(v);
    const code = lts?.[1] ?? v.split(/[-\s]/)[0] ?? '';
    if (NODE_CODENAMES[code]) return NODE_CODENAMES[code];
  }

  if (product === 'python') {
    v = v.replace(/^(python|py|cpython)\s*-?\s*/, '');
  }

  const debian = product === 'debian' ? DEBIAN_CODENAMES[v] : undefined;
  if (debian) return debian;
  const ubuntu = product === 'ubuntu' ? UBUNTU_CODENAMES[v.split('-')[0] ?? ''] : undefined;
  if (ubuntu) return ubuntu;

  // Strip range operators and a leading "v": ^1.2.3, ~=4.2, >=3.8, ==3.2.*
  v = v.replace(/^(\^|~=|~|>=|<=|==+|=|>|<)\s*/, '');
  v = v.replace(/^v(?=\d)/, '');
  return v;
}

/** Leading numeric segments: "3.12.1-slim" -> [3, 12, 1]. */
export function numericParts(v: string): number[] | null {
  const m = /^(\d+(?:\.\d+)*)/.exec(v);
  if (!m || !m[1]) return null;
  return m[1].split('.').map(Number);
}

/** Numeric parts of a cycle name, or null if the cycle is not purely numeric ("3.5-sp1", "macos-14"). */
export function cycleParts(cycle: string): number[] | null {
  return /^\d+(\.\d+)*$/.test(cycle) ? cycle.split('.').map(Number) : null;
}

function compareParts(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x - y;
  }
  return 0;
}

export type ResolveMode = 'exact' | 'newest';

export type CycleResolution =
  | { kind: 'match'; release: SnapshotRelease; normalised: string; matchedBy: 'exact' | 'codename' | 'prefix' | 'newest' }
  | { kind: 'ambiguous'; candidates: string[]; normalised: string }
  | { kind: 'older-than-tracked'; oldest: SnapshotRelease; normalised: string }
  | { kind: 'none'; normalised: string };

/**
 * Resolves a version to one release cycle.
 * - exact cycle name or codename wins;
 * - otherwise the longest cycle that is a numeric prefix of the version ("8" for "8.0.11",
 *   "4.8.1" over "4.8" for "4.8.1");
 * - a version less specific than the cycles ("8" for MySQL 8.0 to 8.4) is ambiguous, unless
 *   mode is "newest" (floating Docker tags), which picks the newest matching cycle;
 * - a version older than every tracked cycle is reported as such, so callers can infer end of life.
 */
export function resolveCycle(product: SnapshotProduct, rawVersion: string, mode: ResolveMode = 'exact'): CycleResolution {
  const normalised = normaliseVersion(product.name, rawVersion);
  const releases = product.releases;

  const exact = releases.find((r) => r.cycle.toLowerCase() === normalised);
  if (exact) return { kind: 'match', release: exact, normalised, matchedBy: 'exact' };

  const byCodename = releases.find((r) => {
    const c = r.codename?.toLowerCase();
    return !!c && (c === normalised || c.split(/\s+/)[0] === normalised);
  });
  if (byCodename) return { kind: 'match', release: byCodename, normalised, matchedBy: 'codename' };

  const vparts = numericParts(normalised);
  if (!vparts) return { kind: 'none', normalised };

  let best: { r: SnapshotRelease; len: number } | undefined;
  for (const r of releases) {
    const c = cycleParts(r.cycle);
    if (!c || c.length > vparts.length) continue;
    if (c.every((n, i) => n === vparts[i]) && (!best || c.length > best.len)) best = { r, len: c.length };
  }
  if (best) return { kind: 'match', release: best.r, normalised, matchedBy: 'prefix' };

  // Less specific than the cycles: "8" against 8.0, 8.1 ... 8.4
  const wider = releases.filter((r) => {
    const c = cycleParts(r.cycle);
    return !!c && c.length > vparts.length && vparts.every((n, i) => n === c[i]);
  });
  if (wider.length === 1) return { kind: 'match', release: wider[0]!, normalised, matchedBy: 'prefix' };
  if (wider.length > 1) {
    const sorted = [...wider].sort((a, b) => compareParts(cycleParts(b.cycle)!, cycleParts(a.cycle)!));
    if (mode === 'newest') return { kind: 'match', release: sorted[0]!, normalised, matchedBy: 'newest' };
    return { kind: 'ambiguous', candidates: sorted.map((r) => r.cycle), normalised };
  }

  // Cycles with a suffix: "3.5" -> "3.5-sp1"
  const versionHead = vparts.join('.');
  const suffixed = releases.filter((r) => r.cycle.toLowerCase().startsWith(`${versionHead}-`));
  if (suffixed.length === 1) return { kind: 'match', release: suffixed[0]!, normalised, matchedBy: 'prefix' };

  // Older than anything tracked: compare at the precision of the cycles.
  const numeric = releases.filter((r) => cycleParts(r.cycle));
  if (numeric.length > 0) {
    const oldest = numeric.reduce((a, b) => (compareParts(cycleParts(a.cycle)!, cycleParts(b.cycle)!) <= 0 ? a : b));
    const op = cycleParts(oldest.cycle)!;
    if (compareParts(vparts.slice(0, op.length), op) < 0) return { kind: 'older-than-tracked', oldest, normalised };
  }

  return { kind: 'none', normalised };
}

/** True / false when we can tell whether `version` is the newest patch in its cycle; null otherwise. */
export function isLatestPatch(version: string, latest: string | undefined): boolean | null {
  if (!latest) return null;
  const v = numericParts(version);
  const l = numericParts(latest.toLowerCase().replace(/^v/, ''));
  if (!v || !l || v.length < l.length) return null;
  return compareParts(v, l) >= 0;
}
