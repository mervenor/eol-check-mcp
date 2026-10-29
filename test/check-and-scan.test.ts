import { describe, expect, it } from 'vitest';
import { Catalogue } from '../src/catalogue.js';
import { checkVersion, getCycles, listProducts } from '../src/check.js';
import { detectorFor, reconcile, scanProject } from '../src/scan/index.js';
import type { Detection } from '../src/scan/types.js';
import { fixtureSnapshot, TODAY } from './fixture-snapshot.js';

const catalogue = new Catalogue(fixtureSnapshot);

describe('checkVersion', () => {
  it('answers .NET 8 with status, dates, days left and the upgrade target', () => {
    const r = checkVersion(catalogue, '.NET', 'net8.0', TODAY);
    expect(r.found).toBe(true);
    expect(r.status).toBe('supported');
    expect(r.cycle?.securitySupportEnds).toBe('2026-11-10');
    expect(r.cycle?.daysRemaining).toBe(13);
    expect(r.recommendedUpgrade?.cycle).toBe('10');
    expect(r.newestCycle?.cycle).toBe('10');
    expect(r.summary).toBe(
      'Microsoft .NET 8 (LTS) is supported until 10 November 2026 (13 days left). Recommended upgrade: Microsoft .NET 10 (LTS), supported until 14 November 2028.',
    );
  });

  it('uses the date parameter for "will it still be supported" questions', () => {
    const r = checkVersion(catalogue, 'dotnet', '9', '2026-12-01');
    expect(r.status).toBe('end-of-life');
    expect(r.cycle?.daysOverdue).toBe(21);
  });

  it('points AngularJS at Angular as a successor', () => {
    const r = checkVersion(catalogue, 'angularjs', '1.8.2', TODAY);
    expect(r.status).toBe('end-of-life');
    expect(r.cycle?.daysOverdue).toBe(1762);
    expect(r.recommendedUpgrade).toBeNull();
    expect(r.successor?.product).toBe('angular');
    expect(r.successor?.recommended?.cycle).toBe('22');
    expect(r.summary).toContain('reached end of life on 31 December 2021');
    expect(r.summary).toContain('Extended Long Term Support is still available');
  });

  it('suggests the newest 4.x and then modern .NET for an old .NET Framework', () => {
    const r = checkVersion(catalogue, 'dotnetfx', 'v4.5.2', TODAY);
    expect(r.status).toBe('end-of-life');
    expect(r.recommendedUpgrade?.cycle).toBe('4.8.1');
    expect(r.successor?.recommended?.cycle).toBe('10');
    expect(r.summary).toMatch(/Recommended upgrade: Microsoft .NET Framework 4.8.1\. Longer term: /);
  });

  it('flags when the version is behind the latest patch in the recommended cycle', () => {
    const r = checkVersion(catalogue, 'dotnet', '10.0.1', TODAY);
    expect(r.versionIsLatestInCycle).toBe(false);
    expect(r.summary).toContain('update to the latest patch, 10.0.13');
  });

  it('treats versions older than every tracked cycle as end of life', () => {
    const r = checkVersion(catalogue, 'nodejs', '0.12.18', TODAY);
    expect(r.status).toBe('end-of-life');
    expect(r.olderThanTracked).toBe(true);
  });

  it('asks for a more specific version when it is ambiguous', () => {
    const r = checkVersion(catalogue, 'mysql', '8', TODAY);
    expect(r.status).toBe('unknown');
    expect(r.candidates).toEqual(['8.4', '8.0']);
  });

  it('returns suggestions for unknown products', () => {
    const r = checkVersion(catalogue, 'postgress', '12', TODAY);
    expect(r.found).toBe(false);
    expect(r.status).toBe('not-found');
    expect(r.suggestions).toContain('postgresql');
  });

  it('checks a .NET Framework version asked for as ".NET" on the right product', () => {
    const r = checkVersion(catalogue, '.NET', '4.8', TODAY);
    expect(r.product?.id).toBe('dotnetfx');
    expect(r.cycle?.cycle).toBe('4.8');
    expect(r.summary).toMatch(/^"4.8" is a Microsoft .NET Framework version, so we checked that\./);
  });

  it('says so when a cycle is not released yet on the date asked', () => {
    const r = checkVersion(catalogue, 'dotnet', '11', TODAY);
    expect(r.summary).toMatch(/^Microsoft .NET 11 is not released until 10 November 2026\./);
  });
});

describe('getCycles and listProducts', () => {
  it('lists cycles newest first with status', () => {
    const r = getCycles(catalogue, 'dotnet', TODAY);
    expect(r.cycles.map((c) => c.cycle)).toEqual(['11', '10', '9', '8', '6', '3.1', '1.0']);
    expect(r.cycles.find((c) => c.cycle === '6')?.status).toBe('end-of-life');
    expect(getCycles(catalogue, 'dotnet', TODAY, 2).cycles).toHaveLength(2);
    expect(getCycles(catalogue, 'nope', TODAY).found).toBe(false);
  });

  it('filters products', () => {
    expect(listProducts(catalogue, 'angular').products.map((p) => p.id)).toEqual(['angularjs', 'angular']);
    expect(listProducts(catalogue).total).toBe(fixtureSnapshot.products.length);
  });
});

describe('detectorFor', () => {
  it.each([
    ['package.json', true],
    ['src/web/package-lock.json', true],
    ['Web.csproj', true],
    ['Legacy.vbproj', true],
    ['Directory.Build.props', true],
    ['requirements-dev.txt', true],
    ['requirements/base.txt', false],
    ['Dockerfile', true],
    ['api.Dockerfile', true],
    ['Dockerfile.prod', true],
    ['docker-compose.override.yml', true],
    ['compose.yaml', true],
    ['README.md', false],
  ])('%s -> %s', (path, known) => {
    expect(detectorFor(path) !== null).toBe(known);
  });
});

describe('reconcile', () => {
  const d = (over: Partial<Detection>): Detection => ({ product: 'react', version: '18.0.0', precision: 'minimum', file: 'package.json', evidence: '', ...over });

  it('prefers the lock file version over the package.json range', () => {
    const range = d({ dependencyKey: 'npm:react' });
    const lock = d({ version: '18.2.0', precision: 'exact', file: 'package-lock.json', dependencyKey: 'npm:react' });
    const { kept, supporting } = reconcile([range, lock]);
    expect(kept).toEqual([lock]);
    expect(supporting.get(lock)).toEqual([range]);
  });

  it('prefers a pinned runtime over an engines range', () => {
    const engines = d({ product: 'nodejs', version: '8.0.0' });
    const nvmrc = d({ product: 'nodejs', version: '18.19.0', precision: 'exact', file: '.nvmrc' });
    expect(reconcile([engines, nvmrc]).kept).toEqual([nvmrc]);
  });
});

describe('scanProject', () => {
  const files = [
    {
      path: 'Web.csproj',
      content: '<Project Sdk="Microsoft.NET.Sdk.Web"><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>',
    },
    { path: 'package.json', content: JSON.stringify({ dependencies: { angular: '1.8.2', react: '^18.2.0' }, engines: { node: '>=20' } }) },
    { path: '.nvmrc', content: '22\n' },
    { path: 'Dockerfile', content: 'FROM postgres:12.4\nFROM mcr.microsoft.com/dotnet/aspnet:8.0' },
    { path: 'notes.txt', content: 'hello' },
  ];

  it('detects, merges and sorts findings by urgency', () => {
    const r = scanProject(catalogue, files, TODAY);
    expect(r.findings.map((x) => `${x.product}:${x.cycle}:${x.status}:${x.urgency}`)).toEqual([
      'angularjs:1.8:end-of-life:critical',
      'postgresql:12:end-of-life:critical',
      'dotnet:8:supported:high',
      'nodejs:22:security-only:medium',
      'react:18:security-only:medium',
    ]);
    const net = r.findings.find((x) => x.product === 'dotnet');
    expect(net?.name).toBe('ASP.NET Core on Microsoft .NET 8 (LTS)');
    expect(net?.evidence.map((e) => e.file).sort()).toEqual(['Dockerfile', 'Web.csproj']);
    expect(r.counts).toEqual({ supported: 1, 'security-only': 2, 'end-of-life': 2, unknown: 0, 'not-found': 0 });
    expect(r.filesScanned.find((x) => x.path === 'notes.txt')?.recognisedAs).toBeNull();
  });

  it('writes a one-paragraph plain-English summary that names what to upgrade first', () => {
    const r = scanProject(catalogue, files, TODAY);
    expect(r.summary).not.toContain('\n');
    expect(r.summary).toContain('On 28 October 2026 we found 5 components');
    expect(r.summary).toContain('2 are past end of life: AngularJS 1.8 (ended 31 December 2021) and PostgreSQL 12 (ended 21 November 2024).');
    expect(r.summary).toContain('1 loses support within 90 days: ASP.NET Core on Microsoft .NET 8 on 10 November 2026.');
    expect(r.summary).toContain('Upgrade AngularJS 1.8 first: it has had no security fixes for 1,762 days; the target is Angular 22.');
  });

  it('keeps the same library in two folders separate (monorepo)', () => {
    const r = scanProject(
      catalogue,
      [
        { path: 'apps/old/package.json', content: '{"dependencies":{"angular":"1.5.11"}}' },
        { path: 'apps/new/package.json', content: '{"dependencies":{"@angular/core":"22.0.0","react":"19.0.0"}}' },
        { path: 'apps/new/package-lock.json', content: '{"lockfileVersion":3,"packages":{"node_modules/react":{"version":"19.3.1"}}}' },
      ],
      TODAY,
    );
    expect(r.findings.map((x) => `${x.product}:${x.cycle}:${x.precision}`)).toEqual(['angularjs:1.5:exact', 'angular:22:exact', 'react:19:exact']);
    expect(r.findings.find((x) => x.product === 'react')?.version).toBe('19.3.1');
  });

  it('notes a project file without a target framework', () => {
    const r = scanProject(catalogue, [{ path: 'Api.csproj', content: '<Project Sdk="Microsoft.NET.Sdk.Web"></Project>' }], TODAY);
    expect(r.notes[0]).toMatch(/Directory.Build.props/);
  });

  it('says when nothing could be checked', () => {
    const r = scanProject(catalogue, [{ path: 'README.md', content: '# hi' }], TODAY);
    expect(r.findings).toEqual([]);
    expect(r.summary).toMatch(/found no runtime or framework version/);
  });

  it('reports "nothing urgent" for a current stack', () => {
    const r = scanProject(catalogue, [{ path: 'Api.csproj', content: '<Project><PropertyGroup><TargetFramework>net10.0</TargetFramework></PropertyGroup></Project>' }], TODAY);
    expect(r.summary).toContain('Nothing needs attention now');
  });
});
