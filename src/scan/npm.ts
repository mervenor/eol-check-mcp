/** package.json, package-lock.json, bower.json and angular.json. */
import { npmMinimum } from './ranges.js';
import type { Detection, DetectorResult, FileInput } from './types.js';

/** npm package name -> endoflife.date product id. The first group is what the brief requires. */
export const NPM_PACKAGES: Record<string, string> = {
  angular: 'angularjs',
  '@angular/core': 'angular',
  react: 'react',
  next: 'nextjs',
  vue: 'vue',
  // Further packages tracked by endoflife.date and common in web applications.
  nuxt: 'nuxt',
  'nuxt3': 'nuxt',
  svelte: 'svelte',
  'ember-source': 'emberjs',
  electron: 'electron',
  express: 'express',
  jquery: 'jquery',
  'jquery-ui': 'jquery-ui',
  'jquery-ui-dist': 'jquery-ui',
  bootstrap: 'bootstrap',
  '@ionic/core': 'ionic',
  '@ionic/angular': 'ionic',
  '@ionic/react': 'ionic',
  '@ionic/vue': 'ionic',
  'react-native': 'react-native',
  eslint: 'eslint',
  tailwindcss: 'tailwind-css',
};

/** Packages that only exist alongside another one we already report; we skip them to avoid noise. */
const SKIP_WHEN_PRESENT: Record<string, string> = {
  '@ionic/angular': '@ionic/core',
  '@ionic/react': '@ionic/core',
  '@ionic/vue': '@ionic/core',
};

const DEP_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] as const;

function parseJson(file: FileInput): Record<string, unknown> | string {
  try {
    const v: unknown = JSON.parse(file.content.replace(/^\uFEFF/, ''));
    if (!v || typeof v !== 'object' || Array.isArray(v)) return `${file.path}: expected a JSON object.`;
    return v as Record<string, unknown>;
  } catch (err) {
    return `${file.path}: could not parse JSON (${(err as Error).message}).`;
  }
}

function record(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value)) if (typeof v === 'string') out[k] = v;
  return out;
}

/** Detects from a dependency map (package.json or bower.json). */
function fromDependencyMap(file: FileInput, deps: Record<string, string>, field: string, manager: 'npm' | 'bower'): Detection[] {
  const out: Detection[] = [];
  for (const [pkg, spec] of Object.entries(deps)) {
    const product = NPM_PACKAGES[pkg];
    if (!product) continue;
    const skipIf = SKIP_WHEN_PRESENT[pkg];
    if (skipIf && deps[skipIf]) continue;
    const r = npmMinimum(spec);
    out.push({
      product,
      version: r?.version ?? '',
      precision: r?.precision ?? 'unknown',
      file: file.path,
      evidence: `${field}.${pkg} "${spec}"`,
      dependencyKey: `${manager}:${pkg}`,
    });
  }
  return out;
}

export function scanPackageJson(file: FileInput): DetectorResult {
  const json = parseJson(file);
  if (typeof json === 'string') return { kind: 'package.json', detections: [], notes: [json] };
  const detections: Detection[] = [];
  const notes: string[] = [];

  for (const field of DEP_FIELDS) {
    detections.push(...fromDependencyMap(file, record(json[field]), field, 'npm'));
  }

  const engines = record(json.engines);
  if (engines.node) {
    const r = npmMinimum(engines.node);
    if (r) {
      detections.push({
        product: 'nodejs',
        version: r.version,
        precision: r.precision,
        file: file.path,
        evidence: `engines.node "${engines.node}"`,
      });
    } else {
      notes.push(`${file.path}: engines.node "${engines.node}" has no lower bound we can read.`);
    }
  }

  const volta = record(json.volta);
  if (volta.node) {
    const r = npmMinimum(volta.node);
    if (r) {
      detections.push({ product: 'nodejs', version: r.version, precision: 'exact', file: file.path, evidence: `volta.node "${volta.node}"` });
    }
  }
  return { kind: 'package.json', detections, notes };
}

export function scanBowerJson(file: FileInput): DetectorResult {
  const json = parseJson(file);
  if (typeof json === 'string') return { kind: 'bower.json', detections: [], notes: [json] };
  const detections: Detection[] = [];
  for (const field of ['dependencies', 'devDependencies'] as const) {
    detections.push(...fromDependencyMap(file, record(json[field]), field, 'bower'));
  }
  return { kind: 'bower.json', detections, notes: [] };
}

/** package-lock.json (lockfileVersion 1, 2 and 3). Only top-level installs are reported. */
export function scanPackageLock(file: FileInput): DetectorResult {
  const json = parseJson(file);
  if (typeof json === 'string') return { kind: 'package-lock.json', detections: [], notes: [json] };
  const detections: Detection[] = [];
  const seen = new Set<string>();

  const add = (pkg: string, version: unknown, evidencePath: string): void => {
    const product = NPM_PACKAGES[pkg];
    if (!product || typeof version !== 'string' || seen.has(pkg)) return;
    if (!/^\d/.test(version)) return;
    seen.add(pkg);
    detections.push({
      product,
      version,
      precision: 'exact',
      file: file.path,
      evidence: `${evidencePath} ${version}`,
      dependencyKey: `npm:${pkg}`,
      locked: true,
    });
  };

  const packages = json.packages;
  if (packages && typeof packages === 'object') {
    for (const [key, info] of Object.entries(packages as Record<string, { version?: unknown }>)) {
      const m = /^node_modules\/((?:@[^/]+\/)?[^/]+)$/.exec(key);
      if (m?.[1]) add(m[1], info?.version, key);
    }
  }
  const dependencies = json.dependencies;
  if (dependencies && typeof dependencies === 'object') {
    for (const [pkg, info] of Object.entries(dependencies as Record<string, { version?: unknown }>)) {
      add(pkg, info?.version, `dependencies.${pkg}`);
    }
  }
  return { kind: 'package-lock.json', detections, notes: [] };
}

/**
 * angular.json tells us the project uses Angular (2+) but not which version; the version
 * comes from package.json or package-lock.json when those are supplied too.
 */
export function scanAngularJson(file: FileInput): DetectorResult {
  const json = parseJson(file);
  if (typeof json === 'string') return { kind: 'angular.json', detections: [], notes: [json] };
  const projects = json.projects && typeof json.projects === 'object' ? Object.keys(json.projects) : [];
  return {
    kind: 'angular.json',
    detections: [
      {
        product: 'angular',
        version: '',
        precision: 'unknown',
        file: file.path,
        evidence: `Angular workspace${projects.length ? ` (${projects.slice(0, 3).join(', ')})` : ''}`,
        dependencyKey: 'npm:@angular/core',
      },
    ],
    notes: [],
  };
}
