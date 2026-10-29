/** requirements*.txt, pyproject.toml, .python-version, runtime.txt, Pipfile. */
import { parse as parseToml } from 'smol-toml';
import { pythonMinimum } from './ranges.js';
import type { Detection, DetectorResult, FileInput } from './types.js';

/** PyPI package name (normalised) -> endoflife.date product id. */
export const PYPI_PACKAGES: Record<string, string> = {
  django: 'django',
  wagtail: 'wagtail',
  numpy: 'numpy',
  'ansible-core': 'ansible-core',
};

function normalisePypi(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, '-');
}

function detectionFor(pkg: string, spec: string, file: FileInput, evidence: string): Detection | null {
  const product = PYPI_PACKAGES[normalisePypi(pkg)];
  if (!product) return null;
  const r = pythonMinimum(spec);
  return {
    product,
    version: r?.version ?? '',
    precision: r?.precision ?? 'unknown',
    file: file.path,
    evidence,
    dependencyKey: `pypi:${normalisePypi(pkg)}`,
  };
}

/** One requirement line: "Django==3.2.18", "django[argon2]>=4.2,<5 ; python_version>'3.8'". */
export function parseRequirementLine(line: string): { name: string; spec: string } | null {
  const clean = line.replace(/\s+#.*$/, '').split(';')[0]?.trim() ?? '';
  if (!clean || clean.startsWith('#') || clean.startsWith('-')) return null;
  const m = /^([A-Za-z0-9][A-Za-z0-9._-]*)\s*(\[[^\]]*\])?\s*(.*)$/.exec(clean);
  if (!m?.[1]) return null;
  return { name: m[1], spec: (m[3] ?? '').trim() };
}

export function scanRequirements(file: FileInput): DetectorResult {
  const detections: Detection[] = [];
  for (const raw of file.content.split(/\r?\n/)) {
    const req = parseRequirementLine(raw);
    if (!req) continue;
    const d = detectionFor(req.name, req.spec, file, raw.trim());
    if (d) detections.push(d);
  }
  return { kind: 'requirements.txt', detections, notes: [] };
}

function pythonDetection(spec: string, file: FileInput, evidence: string): Detection | null {
  const r = pythonMinimum(spec);
  if (!r) return null;
  return { product: 'python', version: r.version, precision: r.precision === 'exact' ? 'exact' : 'minimum', file: file.path, evidence };
}

export function scanPyproject(file: FileInput): DetectorResult {
  let doc: Record<string, unknown>;
  try {
    doc = parseToml(file.content) as Record<string, unknown>;
  } catch (err) {
    return { kind: 'pyproject.toml', detections: [], notes: [`${file.path}: could not parse TOML (${(err as Error).message.split('\n')[0]}).`] };
  }
  const detections: Detection[] = [];
  const project = (doc.project ?? {}) as Record<string, unknown>;
  const poetry = ((doc.tool as Record<string, unknown> | undefined)?.poetry ?? {}) as Record<string, unknown>;

  if (typeof project['requires-python'] === 'string') {
    const d = pythonDetection(project['requires-python'], file, `project.requires-python "${project['requires-python']}"`);
    if (d) detections.push(d);
  }

  const deps = Array.isArray(project.dependencies) ? project.dependencies : [];
  for (const dep of deps) {
    if (typeof dep !== 'string') continue;
    const req = parseRequirementLine(dep);
    if (!req) continue;
    const d = detectionFor(req.name, req.spec, file, `project.dependencies "${dep}"`);
    if (d) detections.push(d);
  }

  const poetryDeps = (poetry.dependencies ?? {}) as Record<string, unknown>;
  for (const [name, value] of Object.entries(poetryDeps)) {
    const spec = typeof value === 'string' ? value : typeof (value as { version?: unknown })?.version === 'string' ? (value as { version: string }).version : '';
    if (name.toLowerCase() === 'python') {
      if (!detections.some((d) => d.product === 'python')) {
        const d = pythonDetection(spec, file, `tool.poetry.dependencies.python "${spec}"`);
        if (d) detections.push(d);
      }
      continue;
    }
    const d = detectionFor(name, spec, file, `tool.poetry.dependencies.${name} "${spec}"`);
    if (d && !detections.some((x) => x.dependencyKey === d.dependencyKey)) detections.push(d);
  }
  return { kind: 'pyproject.toml', detections, notes: [] };
}

/** .python-version ("3.11.4") and runtime.txt ("python-3.9.18"). */
export function scanPythonVersionFile(file: FileInput, kind: string): DetectorResult {
  const line = file.content.split(/\r?\n/).map((l) => l.trim()).find((l) => l && !l.startsWith('#')) ?? '';
  const m = /^(?:python-?)?(\d+\.\d+(?:\.\d+)?)/i.exec(line);
  if (!m?.[1]) return { kind, detections: [], notes: line ? [`${file.path}: unrecognised Python version "${line}".`] : [] };
  return { kind, detections: [{ product: 'python', version: m[1], precision: 'exact', file: file.path, evidence: line }], notes: [] };
}

/** Pipfile: [requires] python_version = "3.8" and [packages] django = "==3.2". */
export function scanPipfile(file: FileInput): DetectorResult {
  let doc: Record<string, unknown>;
  try {
    doc = parseToml(file.content) as Record<string, unknown>;
  } catch (err) {
    return { kind: 'Pipfile', detections: [], notes: [`${file.path}: could not parse TOML (${(err as Error).message.split('\n')[0]}).`] };
  }
  const detections: Detection[] = [];
  const requires = (doc.requires ?? {}) as Record<string, unknown>;
  const pv = requires.python_full_version ?? requires.python_version;
  if (typeof pv === 'string') {
    detections.push({ product: 'python', version: pv, precision: 'exact', file: file.path, evidence: `[requires] python_version = "${pv}"` });
  }
  const packages = (doc.packages ?? {}) as Record<string, unknown>;
  for (const [name, value] of Object.entries(packages)) {
    const spec = typeof value === 'string' ? value : typeof (value as { version?: unknown })?.version === 'string' ? (value as { version: string }).version : '';
    const d = detectionFor(name, spec === '*' ? '' : spec, file, `[packages] ${name} = "${spec}"`);
    if (d) detections.push(d);
  }
  return { kind: 'Pipfile', detections, notes: [] };
}
