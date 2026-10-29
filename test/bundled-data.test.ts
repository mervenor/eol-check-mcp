/**
 * Checks the bundled snapshot itself: that it loads, is credited correctly, and still says what
 * the README promises. If a refresh changes one of these facts upstream, this test fails on
 * purpose so the README and launch material can be corrected.
 */
import { describe, expect, it } from 'vitest';
import { Catalogue } from '../src/catalogue.js';
import { checkVersion } from '../src/check.js';
import { BUNDLED_SNAPSHOT_PATH, loadSnapshot, readSnapshotFile } from '../src/data.js';

const snapshot = readSnapshotFile(BUNDLED_SNAPSHOT_PATH);
const catalogue = new Catalogue(snapshot);
const release = (product: string, cycle: string) => catalogue.get(product)?.releases.find((r) => r.cycle === cycle);

describe('bundled snapshot', () => {
  it('is dated, sourced and licensed', () => {
    expect(snapshot.schemaVersion).toBe(1);
    expect(snapshot.dataDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(snapshot.source.name).toBe('endoflife.date');
    expect(snapshot.source.licence).toBe('MIT');
    expect(snapshot.source.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(snapshot.productCount).toBe(snapshot.products.length);
    expect(snapshot.products.length).toBeGreaterThan(400);
  });

  it('contains every product the scanner maps to', () => {
    for (const id of ['nodejs', 'dotnet', 'dotnetfx', 'angularjs', 'angular', 'react', 'nextjs', 'vue', 'python', 'django', 'postgresql', 'mysql']) {
      expect(catalogue.get(id), id).toBeDefined();
    }
  });

  it('shows .NET 8 and .NET 9 end of support on 10 November 2026', () => {
    expect(release('dotnet', '8')?.eol).toBe('2026-11-10');
    expect(release('dotnet', '9')?.eol).toBe('2026-11-10');
  });

  it('shows AngularJS end of life on 31 December 2021 for every 1.x cycle', () => {
    const cycles = catalogue.get('angularjs')?.releases ?? [];
    expect(cycles.length).toBeGreaterThan(0);
    for (const r of cycles) expect(r.eol, r.cycle).toBe('2021-12-31');
  });

  it('answers the headline questions with a fixed date', () => {
    expect(checkVersion(catalogue, 'dotnet', '8', '2026-10-28').cycle?.daysRemaining).toBe(13);
    expect(checkVersion(catalogue, 'dotnet', '8', '2026-11-11').status).toBe('end-of-life');
    expect(checkVersion(catalogue, 'angularjs', '1.8.3', '2026-10-28').status).toBe('end-of-life');
  });

  it('loads through loadSnapshot without network access', () => {
    const loaded = loadSnapshot({ HOME: '/nonexistent', XDG_CACHE_HOME: '/nonexistent' });
    expect(loaded.origin).toBe('bundled');
    expect(loaded.snapshot.dataDate).toBe(snapshot.dataDate);
  });
});
