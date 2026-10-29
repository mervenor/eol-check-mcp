/**
 * scan_project: routes each supplied file to a detector, merges what they find, checks every
 * runtime and framework against the snapshot and writes a plain-English summary.
 */
import type { Catalogue } from '../catalogue.js';
import { checkVersion, type CheckResult } from '../check.js';
import { formatDate, formatDays } from '../dates.js';
import { roleWeight } from '../roles.js';
import { statusText, SOON_DAYS, URGENCY_RANK, type SupportStatus, type Urgency } from '../status.js';
import { scanMsbuild, scanGlobalJson, scanPackagesConfig, scanWebConfig } from './dotnet.js';
import { scanCompose, scanDockerfile } from './docker.js';
import { scanNvmrc, scanToolVersions } from './misc.js';
import { scanAngularJson, scanBowerJson, scanPackageJson, scanPackageLock } from './npm.js';
import { scanPipfile, scanPyproject, scanPythonVersionFile, scanRequirements } from './python.js';
import type { Detection, DetectorResult, FileInput, Precision } from './types.js';

export type { FileInput } from './types.js';

export const SUPPORTED_FILES = [
  'package.json',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'angular.json',
  'bower.json',
  '*.csproj / *.vbproj / *.fsproj',
  'Directory.Build.props',
  'global.json',
  'web.config',
  'packages.config',
  'requirements*.txt',
  'pyproject.toml',
  'Pipfile',
  '.python-version',
  'runtime.txt',
  '.nvmrc',
  '.node-version',
  '.tool-versions',
  'Dockerfile / *.dockerfile / Containerfile',
  'docker-compose*.yml / compose*.yaml',
];

function baseName(p: string): string {
  return (p.split(/[\\/]/).pop() ?? p).trim();
}

function dirName(p: string): string {
  const parts = p.split(/[\\/]/);
  parts.pop();
  return parts.join('/');
}

export function detectorFor(path: string): ((f: FileInput) => DetectorResult) | null {
  const name = baseName(path);
  const lower = name.toLowerCase();
  if (lower === 'package.json') return scanPackageJson;
  if (lower === 'package-lock.json' || lower === 'npm-shrinkwrap.json') return scanPackageLock;
  if (lower === 'angular.json' || lower === '.angular-cli.json') return scanAngularJson;
  if (lower === 'bower.json') return scanBowerJson;
  if (/\.(cs|vb|fs)proj$/.test(lower)) return (f) => scanMsbuild(f, 'project file');
  if (lower === 'directory.build.props' || lower === 'directory.build.targets') return (f) => scanMsbuild(f, 'Directory.Build.props');
  if (lower === 'global.json') return scanGlobalJson;
  if (lower === 'web.config') return scanWebConfig;
  if (lower === 'packages.config') return scanPackagesConfig;
  if (/^(requirements|constraints)([-_.][\w.-]*)?\.(txt|in)$/.test(lower)) return scanRequirements;
  if (lower === 'pyproject.toml') return scanPyproject;
  if (lower === 'pipfile') return scanPipfile;
  if (lower === '.python-version') return (f) => scanPythonVersionFile(f, '.python-version');
  if (lower === 'runtime.txt') return (f) => scanPythonVersionFile(f, 'runtime.txt');
  if (lower === '.nvmrc' || lower === '.node-version') return (f) => scanNvmrc(f, lower);
  if (lower === '.tool-versions') return scanToolVersions;
  if (lower === 'dockerfile' || lower === 'containerfile' || lower.endsWith('.dockerfile') || lower.startsWith('dockerfile.')) return scanDockerfile;
  if (/^(docker-)?compose([-.][\w.-]*)?\.ya?ml$/.test(lower)) return scanCompose;
  return null;
}

export interface Finding {
  product: string;
  productLabel: string;
  /** Framework this finding also stands for (for example "ASP.NET Core" on .NET 8). */
  component: string | null;
  name: string;
  version: string;
  precision: Precision;
  cycle: string | null;
  status: SupportStatus | 'not-found';
  urgency: Urgency;
  releaseDate: string | null;
  activeSupportEnds: string | null;
  securitySupportEnds: string | null;
  daysRemaining: number | null;
  daysOverdue: number | null;
  latestInCycle: string | null;
  newestCycle: string | null;
  /** Newest supported cycle of the same product (LTS preferred), by name and by cycle id. */
  recommendedUpgrade: string | null;
  recommendedCycle: string | null;
  /** Replacement product, when the product itself has been superseded (AngularJS -> Angular, .NET Framework -> .NET). */
  successor: string | null;
  summary: string;
  evidence: { file: string; detail: string }[];
  caveats: string[];
}

export interface ScanResult {
  date: string;
  dataDate: string;
  filesScanned: { path: string; recognisedAs: string | null }[];
  findings: Finding[];
  counts: Record<SupportStatus | 'not-found', number>;
  notes: string[];
  summary: string;
}

/**
 * Drops weaker statements when stronger ones exist:
 *  - for the same dependency (package.json range vs package-lock.json install), keep exact versions;
 *  - for the same runtime (engines.node vs .nvmrc vs Dockerfile), a pinned version beats a minimum.
 * Dropped detections are kept as extra evidence on the one that wins.
 */
export function reconcile(detections: Detection[]): { kept: Detection[]; supporting: Map<Detection, Detection[]> } {
  const rank: Record<Precision, number> = { exact: 0, floating: 1, minimum: 2, unknown: 3 };
  const supporting = new Map<Detection, Detection[]>();
  const dropped = new Set<Detection>();

  const attach = (winner: Detection, loser: Detection): void => {
    dropped.add(loser);
    supporting.set(winner, [...(supporting.get(winner) ?? []), loser]);
  };

  // Same dependency in the same folder (package.json next to package-lock.json): keep the most precise.
  const byDep = new Map<string, Detection[]>();
  for (const d of detections) {
    if (!d.dependencyKey) continue;
    const key = `${dirName(d.file)}|${d.dependencyKey}`;
    byDep.set(key, [...(byDep.get(key) ?? []), d]);
  }
  for (const group of byDep.values()) {
    // The installed version (lock file) wins; otherwise the most precise declaration.
    const locked = group.find((d) => d.locked);
    const best = Math.min(...group.map((d) => rank[d.precision]));
    const winner = locked ?? group.find((d) => rank[d.precision] === best)!;
    for (const d of group) if (d !== winner && (locked || rank[d.precision] > best)) attach(winner, d);
  }

  // Runtime declarations (engines.node, requires-python) give way to a pinned runtime anywhere in
  // the project (.nvmrc, Dockerfile). Library ranges are never dropped this way, so a monorepo
  // with an old Vue in one folder and a new one in another still reports both.
  const byProduct = new Map<string, Detection[]>();
  for (const d of detections) {
    if (dropped.has(d) || d.dependencyKey) continue;
    byProduct.set(d.product, [...(byProduct.get(d.product) ?? []), d]);
  }
  for (const group of byProduct.values()) {
    const pinned = group.find((d) => d.precision === 'exact' || d.precision === 'floating');
    if (!pinned) continue;
    for (const d of group) {
      if ((d.precision === 'minimum' || d.precision === 'unknown') && !dropped.has(d)) attach(pinned, d);
    }
  }
  return { kept: detections.filter((d) => !dropped.has(d)), supporting };
}

function toFinding(d: Detection, check: CheckResult, extra: Detection[]): Finding {
  const caveats: string[] = [];
  // A tag such as "python:3.8" or "node:12" pins one cycle; only a tag that spans several
  // cycles ("mysql:8") is really floating.
  const precision: Precision = d.precision === 'floating' && check.matchedBy !== 'newest' ? 'exact' : d.precision;
  if (precision === 'minimum') {
    caveats.push('Status is for the lowest version the declared range allows; the installed version may be newer. Add the lock file for an exact answer.');
  }
  if (precision === 'floating') {
    caveats.push('The image tag floats across release cycles; we assumed the newest matching cycle.');
  }
  if (precision === 'unknown') {
    caveats.push('We know this is used but not which version. Add package.json or the lock file.');
  }
  const productLabel = check.product?.label ?? d.product;
  const name = check.name ?? `${productLabel}${d.version ? ` ${d.version}` : ''}`;
  return {
    product: d.product,
    productLabel,
    component: d.component ?? null,
    name: d.component ? `${d.component} on ${name}` : name,
    version: d.version,
    precision,
    cycle: check.cycle?.cycle ?? null,
    status: check.status,
    urgency: check.urgency,
    releaseDate: check.cycle?.releaseDate ?? null,
    activeSupportEnds: check.cycle?.activeSupportEnds ?? null,
    securitySupportEnds: check.cycle?.securitySupportEnds ?? null,
    daysRemaining: check.cycle?.daysRemaining ?? null,
    daysOverdue: check.cycle?.daysOverdue ?? null,
    latestInCycle: check.latestInCycle,
    newestCycle: check.newestCycle?.name ?? null,
    recommendedUpgrade: check.recommendedUpgrade?.name ?? null,
    recommendedCycle: check.recommendedUpgrade?.cycle ?? null,
    successor: check.successor?.recommended?.name ?? null,
    summary: precision === 'unknown' ? `${productLabel} is used, but no version was found in the supplied files.` : check.summary,
    evidence: [d, ...extra].map((x) => ({ file: x.file, detail: x.evidence })),
    caveats,
  };
}

/** Merges findings that land on the same product, cycle and component (e.g. Dockerfile + csproj). */
function mergeFindings(findings: Finding[]): Finding[] {
  const out: Finding[] = [];
  for (const f of findings) {
    const same = out.find(
      (o) => o.product === f.product && o.cycle !== null && o.cycle === f.cycle && o.status === f.status,
    );
    if (!same) {
      out.push(f);
      continue;
    }
    for (const e of f.evidence) if (!same.evidence.some((x) => x.file === e.file && x.detail === e.detail)) same.evidence.push(e);
    if (!same.component && f.component) {
      same.component = f.component;
      same.name = f.name;
    }
    if (f.precision === 'exact' && same.precision !== 'exact') {
      same.precision = 'exact';
      same.version = f.version;
      same.caveats = f.caveats;
    }
  }
  return out;
}

/**
 * Most urgent first. Within one urgency level: runtimes, frameworks and databases before
 * libraries and developer tooling; then the longest overdue (or soonest to end); then by name.
 */
export function compareFindings(a: Finding, b: Finding): number {
  const u = URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency];
  if (u !== 0) return u;
  const r = roleWeight(a.product) - roleWeight(b.product);
  if (r !== 0) return r;
  if (a.urgency === 'critical') {
    const o = (b.daysOverdue ?? -1) - (a.daysOverdue ?? -1);
    if (o !== 0) return o;
  } else {
    const d = (a.daysRemaining ?? Number.MAX_SAFE_INTEGER) - (b.daysRemaining ?? Number.MAX_SAFE_INTEGER);
    if (d !== 0) return d;
  }
  return a.name.localeCompare(b.name);
}

/** "Node.js 12 (LTS)" -> "Node.js 12" for use inside sentences that add their own brackets. */
function plainName(name: string): string {
  return name.replace(/ \(LTS\)$/, '');
}

function listNames(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

export function summarise(findings: Finding[], files: number, today: string, dataDate: string): string {
  const known = findings.filter((f) => f.status !== 'not-found' && f.precision !== 'unknown');
  if (known.length === 0) {
    return `We checked ${files} file${files === 1 ? '' : 's'} but found no runtime or framework version we could look up. Supported files: ${SUPPORTED_FILES.slice(0, 6).join(', ')} and more.`;
  }
  const eol = known.filter((f) => f.status === 'end-of-life');
  const soon = known.filter((f) => f.status !== 'end-of-life' && f.daysRemaining !== null && f.daysRemaining <= SOON_DAYS);
  const secOnly = known.filter((f) => f.status === 'security-only' && !soon.includes(f));
  const fine = known.filter((f) => f.status === 'supported' && !soon.includes(f));
  const unknown = known.filter((f) => f.status === 'unknown');

  const parts: string[] = [];
  const asAt = today === dataDate ? formatDate(today) : `${formatDate(today)} (data from ${formatDate(dataDate)})`;
  const n = known.length;
  parts.push(
    `On ${asAt} we found ${n} component${n === 1 ? '' : 's'} with a published support schedule in ${files} file${files === 1 ? '' : 's'}.`,
  );
  if (eol.length) {
    parts.push(
      `${eol.length} ${eol.length === 1 ? 'is' : 'are'} past end of life: ${listNames(
        eol.map((f) => (f.securitySupportEnds ? `${plainName(f.name)} (ended ${formatDate(f.securitySupportEnds)})` : plainName(f.name))),
      )}.`,
    );
  }
  if (soon.length) {
    parts.push(
      `${soon.length} ${soon.length === 1 ? 'loses' : 'lose'} support within ${SOON_DAYS} days: ${listNames(
        soon.map((f) => `${plainName(f.name)} on ${formatDate(f.securitySupportEnds!)}`),
      )}.`,
    );
  }
  if (secOnly.length) parts.push(`${secOnly.length} ${secOnly.length === 1 ? 'gets' : 'get'} security fixes only: ${listNames(secOnly.map((f) => plainName(f.name)))}.`);
  if (fine.length) parts.push(`${fine.length} ${fine.length === 1 ? 'is' : 'are'} fully supported.`);
  if (unknown.length) parts.push(`${unknown.length} could not be matched to a support date.`);

  const first = known[0]!;
  if (first.status === 'end-of-life' || first.urgency === 'high') {
    const why =
      first.status === 'end-of-life'
        ? `it has had no security fixes for ${formatDays(first.daysOverdue ?? 0)}`
        : `support ends in ${formatDays(first.daysRemaining ?? 0)}`;
    const targetName = first.recommendedUpgrade ?? first.successor;
    const target = targetName ? `; the target is ${targetName}` : '';
    parts.push(`Upgrade ${plainName(first.name)} first: ${why}${target}.`);
  } else if (first.urgency === 'medium') {
    const to = first.recommendedCycle && first.recommendedCycle !== first.cycle ? ` to ${first.recommendedUpgrade}` : '';
    const ends = first.securitySupportEnds ? formatDate(first.securitySupportEnds) : null;
    const reason =
      first.status === 'security-only'
        ? `it gets security fixes only${ends ? ` until ${ends}` : ''}`
        : `support ends on ${ends ?? 'a date not yet published'}`;
    parts.push(`Nothing is urgent, but plan to upgrade ${plainName(first.name)}${to}: ${reason}.`);
  } else {
    parts.push('Nothing needs attention now; keep patch versions current.');
  }
  return parts.join(' ');
}

export function scanProject(catalogue: Catalogue, files: FileInput[], today: string): ScanResult {
  const notes: string[] = [];
  const filesScanned: ScanResult['filesScanned'] = [];
  const detections: Detection[] = [];

  for (const file of files) {
    const detector = detectorFor(file.path);
    if (!detector) {
      filesScanned.push({ path: file.path, recognisedAs: null });
      notes.push(`${file.path}: not a file type we read (supported: ${SUPPORTED_FILES.join(', ')}).`);
      continue;
    }
    const r = detector(file);
    filesScanned.push({ path: file.path, recognisedAs: r.kind });
    detections.push(...r.detections);
    notes.push(...r.notes);
  }

  const { kept, supporting } = reconcile(detections);
  const raw = kept.map((d) => {
    const check =
      d.precision === 'unknown'
        ? { ...checkVersion(catalogue, d.product, '', today), status: 'unknown' as const, urgency: 'unknown' as const }
        : checkVersion(catalogue, d.product, d.version, today, d.precision === 'floating' ? 'newest' : 'exact');
    return toFinding(d, check, supporting.get(d) ?? []);
  });
  const findings = mergeFindings(raw).sort(compareFindings);

  const counts: ScanResult['counts'] = { supported: 0, 'security-only': 0, 'end-of-life': 0, unknown: 0, 'not-found': 0 };
  for (const f of findings) counts[f.status] += 1;

  return {
    date: today,
    dataDate: catalogue.snapshot.dataDate,
    filesScanned,
    findings,
    counts,
    notes,
    summary: summarise(findings, files.length, today, catalogue.snapshot.dataDate),
  };
}

export { statusText };
