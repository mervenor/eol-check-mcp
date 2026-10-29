import { describe, expect, it } from 'vitest';
import { daysBetween, formatDate, formatDays, isIsoDate, todayIso } from '../src/dates.js';
import { evaluateRelease, newestCycle, phaseState, recommendedCycle } from '../src/status.js';
import type { SnapshotProduct } from '../src/types.js';
import { fixtureSnapshot, TODAY } from './fixture-snapshot.js';

const product = (name: string): SnapshotProduct => {
  const p = fixtureSnapshot.products.find((x) => x.name === name);
  if (!p) throw new Error(`fixture has no ${name}`);
  return p;
};
const release = (name: string, cycle: string) => {
  const r = product(name).releases.find((x) => x.cycle === cycle);
  if (!r) throw new Error(`fixture has no ${name} ${cycle}`);
  return r;
};

describe('dates', () => {
  it('validates calendar dates', () => {
    expect(isIsoDate('2026-11-10')).toBe(true);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('10/11/2026')).toBe(false);
    expect(isIsoDate(undefined)).toBe(false);
  });

  it('counts whole days across month and year boundaries', () => {
    expect(daysBetween('2026-10-28', '2026-11-10')).toBe(13);
    expect(daysBetween('2021-12-31', '2026-10-28')).toBe(1762);
    expect(daysBetween('2026-11-11', '2026-11-10')).toBe(-1);
  });

  it('formats dates and day counts in British English', () => {
    expect(formatDate('2026-11-10')).toBe('10 November 2026');
    expect(formatDays(1)).toBe('1 day');
    expect(formatDays(-1762)).toBe('1,762 days');
  });

  it('lets EOL_CHECK_TODAY pin the date and ignores invalid values', () => {
    expect(todayIso({ EOL_CHECK_TODAY: '2030-01-01' })).toBe('2030-01-01');
    expect(todayIso({ EOL_CHECK_TODAY: 'tomorrow' })).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('phaseState', () => {
  it('treats a date as reached only after that day', () => {
    expect(phaseState('2026-11-10', '2026-11-10').reached).toBe(false);
    expect(phaseState('2026-11-10', '2026-11-11').reached).toBe(true);
  });
  it('passes booleans through and marks missing phases as untracked', () => {
    expect(phaseState(true, TODAY)).toEqual({ tracked: true, reached: true, date: null });
    expect(phaseState(undefined, TODAY).tracked).toBe(false);
  });
});

describe('evaluateRelease', () => {
  it('.NET 8 is supported with 13 days left on 28 October 2026 (high urgency)', () => {
    const s = evaluateRelease(release('dotnet', '8'), TODAY);
    expect(s.status).toBe('supported');
    expect(s.securitySupportEnds).toBe('2026-11-10');
    expect(s.daysRemaining).toBe(13);
    expect(s.daysOverdue).toBeNull();
    expect(s.urgency).toBe('high');
    expect(s.lts).toBe(true);
  });

  it('10 November 2026 is the last supported day for .NET 8; 11 November is end of life', () => {
    const last = evaluateRelease(release('dotnet', '8'), '2026-11-10');
    expect(last.status).toBe('supported');
    expect(last.daysRemaining).toBe(0);
    const after = evaluateRelease(release('dotnet', '8'), '2026-11-11');
    expect(after.status).toBe('end-of-life');
    expect(after.daysOverdue).toBe(1);
    expect(after.urgency).toBe('critical');
  });

  it('AngularJS 1.8 has been end of life since 31 December 2021', () => {
    const s = evaluateRelease(release('angularjs', '1.8'), TODAY);
    expect(s.status).toBe('end-of-life');
    expect(s.daysOverdue).toBe(1762);
    expect(s.extendedSupport).toBe('available');
  });

  it('reports security-only when active support has ended but security support has not', () => {
    const s = evaluateRelease(release('nodejs', '22'), TODAY);
    expect(s.status).toBe('security-only');
    expect(s.activeSupportEnds).toBe('2025-10-21');
    expect(s.daysRemaining).toBe(184);
    expect(s.urgency).toBe('medium');
  });

  it('handles "eol: false" (no end date) as supported with low urgency', () => {
    const s = evaluateRelease(release('dotnetfx', '4.8'), TODAY);
    expect(s.status).toBe('supported');
    expect(s.securitySupportEnds).toBeNull();
    expect(s.daysRemaining).toBeNull();
    expect(s.urgency).toBe('low');
  });

  it('React 18 is security-only with no published end date', () => {
    const s = evaluateRelease(release('react', '18'), TODAY);
    expect(s.status).toBe('security-only');
    expect(s.urgency).toBe('medium');
  });

  it('marks support ending within a year as medium urgency', () => {
    const s = evaluateRelease(release('postgresql', '14'), '2026-01-01');
    expect(s.status).toBe('supported');
    expect(s.urgency).toBe('medium');
  });

  it('computes LTS from an LTS start date the same way endoflife.date does', () => {
    expect(evaluateRelease(release('nodejs', '26'), '2026-10-28').lts).toBe(false);
    expect(evaluateRelease(release('nodejs', '26'), '2026-10-29').lts).toBe(true);
  });
});

describe('newest and recommended cycles', () => {
  it('ignores cycles whose release date is still in the future', () => {
    expect(newestCycle(product('dotnet'), TODAY)?.cycle).toBe('10');
    expect(newestCycle(product('dotnet'), '2026-11-12')?.cycle).toBe('11');
  });

  it('recommends the newest supported LTS cycle when the product has LTS releases', () => {
    expect(recommendedCycle(product('dotnet'), TODAY)?.cycle).toBe('10');
    expect(recommendedCycle(product('nodejs'), TODAY)?.cycle).toBe('24');
    expect(recommendedCycle(product('mysql'), TODAY)?.cycle).toBe('9.7');
  });

  it('otherwise recommends the newest supported cycle', () => {
    expect(recommendedCycle(product('postgresql'), TODAY)?.cycle).toBe('18');
    expect(recommendedCycle(product('angular'), TODAY)?.cycle).toBe('22');
  });

  it('returns nothing when no cycle is supported', () => {
    expect(recommendedCycle(product('angularjs'), TODAY)).toBeUndefined();
  });
});
