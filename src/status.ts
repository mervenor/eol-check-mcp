/**
 * Support status logic. Everything here is a pure function of (product, release, today), so it
 * can be tested with a fixed date and gives the same answer for any day you ask about.
 *
 * Semantics follow endoflife.date: a phase given as a date is reached when today is AFTER that
 * date, so the date itself is the last day of that phase (for example, .NET 8 is still
 * supported on 10 November 2026 and is end of life from 11 November 2026).
 */
import { daysBetween } from './dates.js';
import type { PhaseValue, SnapshotProduct, SnapshotRelease } from './types.js';

export type SupportStatus = 'supported' | 'security-only' | 'end-of-life' | 'unknown';
export type Urgency = 'critical' | 'high' | 'medium' | 'low' | 'unknown';
export type ExtendedSupport = 'available' | 'ended' | 'not-tracked';

/** End of support within this many days counts as "high" urgency. */
export const SOON_DAYS = 90;
/** End of support within this many days counts as at least "medium" urgency. */
export const YEAR_DAYS = 365;

export const URGENCY_RANK: Record<Urgency, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  unknown: 4,
};

export interface PhaseState {
  tracked: boolean;
  reached: boolean;
  date: string | null;
}

export function phaseState(value: PhaseValue | undefined, today: string): PhaseState {
  if (value === undefined) return { tracked: false, reached: false, date: null };
  if (typeof value === 'boolean') return { tracked: true, reached: value, date: null };
  return { tracked: true, reached: today > value, date: value };
}

export interface CycleStatus {
  cycle: string;
  label: string;
  codename: string | null;
  lts: boolean;
  status: SupportStatus;
  urgency: Urgency;
  releaseDate: string | null;
  activeSupportEnds: string | null;
  securitySupportEnds: string | null;
  extendedSupportEnds: string | null;
  extendedSupport: ExtendedSupport;
  /** Days left until end of security support (0 on the last day). Null when end of life or no date. */
  daysRemaining: number | null;
  /** Days since end of security support (1 on the first day after). Null when not end of life or no date. */
  daysOverdue: number | null;
  latest: string | null;
  latestDate: string | null;
}

/** Same rule as endoflife.date: a cycle counts as LTS from the day after its LTS date. */
export function isLtsOn(release: SnapshotRelease, today: string): boolean {
  if (release.lts === undefined) return false;
  if (typeof release.lts === 'boolean') return release.lts;
  return today > release.lts;
}

export function evaluateRelease(release: SnapshotRelease, today: string): CycleStatus {
  const eoas = phaseState(release.eoas, today);
  const eol = phaseState(release.eol, today);
  const eoes = phaseState(release.eoes, today);

  let status: SupportStatus;
  if (eol.tracked) {
    if (eol.reached) status = 'end-of-life';
    else if (eoas.tracked && eoas.reached) status = 'security-only';
    else status = 'supported';
  } else if (eoas.tracked) {
    status = eoas.reached ? 'security-only' : 'supported';
  } else {
    status = 'unknown';
  }

  let daysRemaining: number | null = null;
  let daysOverdue: number | null = null;
  if (eol.date) {
    const d = daysBetween(today, eol.date);
    if (d >= 0) daysRemaining = d;
    else daysOverdue = -d;
  }

  let urgency: Urgency;
  if (status === 'end-of-life') urgency = 'critical';
  else if (status === 'unknown') urgency = 'unknown';
  else if (daysRemaining !== null && daysRemaining <= SOON_DAYS) urgency = 'high';
  else if (status === 'security-only' || (daysRemaining !== null && daysRemaining <= YEAR_DAYS)) urgency = 'medium';
  else urgency = 'low';

  return {
    cycle: release.cycle,
    label: release.label,
    codename: release.codename ?? null,
    lts: isLtsOn(release, today),
    status,
    urgency,
    releaseDate: release.releaseDate ?? null,
    activeSupportEnds: eoas.date,
    securitySupportEnds: eol.date,
    extendedSupportEnds: eoes.date,
    extendedSupport: !eoes.tracked ? 'not-tracked' : eoes.reached ? 'ended' : 'available',
    daysRemaining,
    daysOverdue,
    latest: release.latest ?? null,
    latestDate: release.latestDate ?? null,
  };
}

function isReleased(release: SnapshotRelease, today: string): boolean {
  return !release.releaseDate || release.releaseDate <= today;
}

/**
 * Releases ordered newest first by release date. Releases without a date keep their upstream
 * order (endoflife.date lists newest first) and sort after dated ones only when compared by date.
 */
export function releasesNewestFirst(product: SnapshotProduct): SnapshotRelease[] {
  return product.releases
    .map((r, i) => ({ r, i }))
    .sort((a, b) => {
      const da = a.r.releaseDate;
      const db = b.r.releaseDate;
      if (da && db && da !== db) return da < db ? 1 : -1;
      return a.i - b.i;
    })
    .map((x) => x.r);
}

/** The most recently released cycle (ignores cycles with a future release date). */
export function newestCycle(product: SnapshotProduct, today: string): SnapshotRelease | undefined {
  return releasesNewestFirst(product).find((r) => isReleased(r, today));
}

/**
 * The cycle we would suggest upgrading to: the newest supported LTS cycle when the product
 * marks LTS releases, otherwise the newest cycle still in support (preferring active support).
 */
export function recommendedCycle(product: SnapshotProduct, today: string): SnapshotRelease | undefined {
  const released = releasesNewestFirst(product).filter((r) => isReleased(r, today));
  const live = released.filter((r) => {
    const s = evaluateRelease(r, today).status;
    return s === 'supported' || s === 'security-only';
  });
  if (live.length === 0) return undefined;
  const lts = live.find((r) => isLtsOn(r, today));
  if (lts) return lts;
  return live.find((r) => evaluateRelease(r, today).status === 'supported') ?? live[0];
}

export function statusText(status: SupportStatus): string {
  switch (status) {
    case 'supported':
      return 'supported';
    case 'security-only':
      return 'security fixes only';
    case 'end-of-life':
      return 'end of life';
    default:
      return 'status unknown';
  }
}
