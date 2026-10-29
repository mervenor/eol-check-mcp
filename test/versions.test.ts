import { describe, expect, it } from 'vitest';
import { Catalogue } from '../src/catalogue.js';
import { isLatestPatch, normaliseVersion, resolveCycle } from '../src/versions.js';
import { fixtureSnapshot } from './fixture-snapshot.js';

const catalogue = new Catalogue(fixtureSnapshot);
const p = (name: string) => {
  const found = catalogue.find(name);
  if (!found) throw new Error(name);
  return found;
};
const cycleOf = (product: string, version: string, mode: 'exact' | 'newest' = 'exact') => {
  const r = resolveCycle(p(product), version, mode);
  return r.kind === 'match' ? r.release.cycle : r.kind;
};

describe('normaliseVersion', () => {
  it.each([
    ['dotnet', 'net8.0', '8.0'],
    ['dotnet', 'net8.0-windows', '8.0'],
    ['dotnet', 'netcoreapp3.1', '3.1'],
    ['dotnet', '.NET 8', '8'],
    ['dotnet', '.NET Core 3.1', '3.1'],
    ['dotnet', 'ASP.NET Core 8', '8'],
    ['dotnetfx', 'net48', '4.8'],
    ['dotnetfx', 'net472', '4.7.2'],
    ['dotnetfx', 'v4.6.2', '4.6.2'],
    ['dotnetfx', '.NET Framework 4.8', '4.8'],
    ['dotnetfx', '3.5 SP1', '3.5-sp1'],
    ['nodejs', 'v18.19.0', '18.19.0'],
    ['nodejs', 'lts/hydrogen', '18'],
    ['nodejs', 'iron', '20'],
    ['nodejs', '^18.12.0', '18.12.0'],
    ['python', 'python-3.9.18', '3.9.18'],
    ['python', '>=3.8', '3.8'],
    ['ubuntu', 'jammy', '22.04'],
  ])('%s %s -> %s', (product, raw, expected) => {
    expect(normaliseVersion(product, raw)).toBe(expected);
  });
});

describe('resolveCycle', () => {
  it('matches the cycle that is a prefix of the version', () => {
    expect(cycleOf('dotnet', '8.0.11')).toBe('8');
    expect(cycleOf('dotnet', 'net8.0')).toBe('8');
    expect(cycleOf('dotnet', '3.1.32')).toBe('3.1');
    expect(cycleOf('angularjs', '1.8.2')).toBe('1.8');
    expect(cycleOf('nodejs', '20.11.0')).toBe('20');
    expect(cycleOf('postgresql', '12.4')).toBe('12');
  });

  it('prefers the longest matching cycle', () => {
    expect(cycleOf('dotnetfx', '4.8.1')).toBe('4.8.1');
    expect(cycleOf('dotnetfx', '4.8')).toBe('4.8');
    expect(cycleOf('dotnetfx', 'net48')).toBe('4.8');
    expect(cycleOf('dotnetfx', 'net472')).toBe('4.7.2');
  });

  it('matches suffixed cycles and codenames', () => {
    expect(cycleOf('dotnetfx', '3.5')).toBe('3.5-sp1');
    expect(cycleOf('ubuntu', 'jammy')).toBe('22.04');
    expect(cycleOf('ubuntu', 'Noble Numbat')).toBe('24.04');
  });

  it('reports a version less specific than the cycles as ambiguous, unless asked for the newest', () => {
    const r = resolveCycle(p('mysql'), '8');
    expect(r.kind).toBe('ambiguous');
    if (r.kind === 'ambiguous') expect(r.candidates).toEqual(['8.4', '8.0']);
    expect(cycleOf('mysql', '8', 'newest')).toBe('8.4');
  });

  it('recognises versions older than every tracked cycle', () => {
    const r = resolveCycle(p('nodejs'), '0.12.18');
    expect(r.kind).toBe('older-than-tracked');
    expect(resolveCycle(p('dotnet'), '0.9').kind).toBe('older-than-tracked');
  });

  it('returns none for versions that match nothing', () => {
    expect(resolveCycle(p('dotnet'), '7.0').kind).toBe('none');
    expect(resolveCycle(p('react'), 'latest').kind).toBe('none');
  });
});

describe('isLatestPatch', () => {
  it('compares against the latest release in the cycle', () => {
    expect(isLatestPatch('8.0.32', '8.0.32')).toBe(true);
    expect(isLatestPatch('8.0.11', '8.0.32')).toBe(false);
    expect(isLatestPatch('8', '8.0.32')).toBeNull();
    expect(isLatestPatch('8.0.11', undefined)).toBeNull();
  });
});

describe('Catalogue', () => {
  it('finds products by id, alias, label and common synonym', () => {
    expect(catalogue.find('nodejs')?.name).toBe('nodejs');
    expect(catalogue.find('Node.js')?.name).toBe('nodejs');
    expect(catalogue.find('node')?.name).toBe('nodejs');
    expect(catalogue.find('.NET')?.name).toBe('dotnet');
    expect(catalogue.find('ASP.NET Core')?.name).toBe('dotnet');
    expect(catalogue.find('.NET Framework')?.name).toBe('dotnetfx');
    expect(catalogue.find('postgres')?.name).toBe('postgresql');
    expect(catalogue.find('Angular.js')?.name).toBe('angularjs');
    expect(catalogue.find('Angular')?.name).toBe('angular');
  });

  it('suggests close matches for typos', () => {
    expect(catalogue.find('postgress')).toBeUndefined();
    expect(catalogue.suggest('postgress')).toContain('postgresql');
    expect(catalogue.suggest('angulr')).toContain('angular');
  });

  it('searches by text and category', () => {
    expect(catalogue.search('net').map((x) => x.name)).toEqual(expect.arrayContaining(['dotnet', 'dotnetfx']));
    expect(catalogue.search(undefined, 'database').map((x) => x.name).sort()).toEqual(['mysql', 'postgresql']);
  });
});
