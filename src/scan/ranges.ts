/** Turning version ranges into the lowest version they allow. */
import semver from 'semver';
import type { Precision } from './types.js';

export interface RangeResult {
  version: string;
  precision: Precision;
}

/**
 * npm-style ranges (package.json, bower.json): "^1.5.8", "~4.2", ">=14", "14.x", "1.2.3 - 2".
 * Returns null for things that are not version ranges (URLs, "latest", "workspace:*", "*").
 */
export function npmMinimum(spec: string): RangeResult | null {
  let s = spec.trim();
  const alias = /^npm:(?:@[^/]+\/)?[^@]+@(.+)$/.exec(s);
  if (alias?.[1]) s = alias[1];
  if (!s || s === '*' || s === 'x' || s === 'latest' || s === 'next') return null;
  if (/^(file|link|git|git\+\w+|https?|workspace|github|portal|patch):/.test(s) || s.includes('/')) return null;

  const exact = semver.valid(semver.clean(s.replace(/^=\s*/, '')) ?? '');
  if (exact) return { version: exact, precision: 'exact' };
  if (!semver.validRange(s)) return null;
  const min = semver.minVersion(s);
  if (!min) return null;
  if (min.major === 0 && min.minor === 0 && min.patch === 0 && !/\b0\.0\.0\b/.test(s)) return null;
  return { version: min.version, precision: 'minimum' };
}

/**
 * Python specifiers (PEP 440 and Poetry): "==3.2.18", ">=3.2,<4", "~=4.2.0", "^3.9", "3.11.*".
 * Returns the lower bound, or null when the specifier has none ("<4", "*").
 */
export function pythonMinimum(spec: string): RangeResult | null {
  const parts = spec
    .split(/[,;]|\|\|/)
    .map((p) => p.trim())
    .filter(Boolean);
  const lows: { v: string; exact: boolean }[] = [];
  for (const part of parts) {
    const m = /^(===|==|~=|>=|>|\^|~|<=|<|!=)?\s*v?([0-9][0-9a-zA-Z.*+!-]*)$/.exec(part);
    if (!m || !m[2]) continue;
    const op = m[1] ?? '==';
    const raw = m[2];
    const numeric = raw.replace(/\.\*$/, '').replace(/[^0-9.].*$/, '').replace(/\.$/, '');
    if (!numeric) continue;
    if (op === '<' || op === '<=' || op === '!=') continue;
    const exact = (op === '==' || op === '===') && !raw.includes('*');
    lows.push({ v: numeric, exact });
  }
  if (lows.length === 0) return null;
  const best = lows.reduce((a, b) => (compareLoose(a.v, b.v) <= 0 ? a : b));
  return { version: best.v, precision: best.exact && lows.length === 1 ? 'exact' : 'minimum' };
}

function compareLoose(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}
