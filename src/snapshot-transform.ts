/**
 * Builds a Snapshot from endoflife.date data. Two inputs are supported:
 *  - the public API v1 "products/full" response (preferred), and
 *  - the product Markdown files (YAML front matter) in the endoflife-date/endoflife.date
 *    Git repository, for when the API cannot be reached.
 * Both produce the same shape, so the rest of the server never needs to know which was used.
 */
import { parse as parseYaml } from 'yaml';
import { isIsoDate } from './dates.js';
import type {
  PhaseLabels,
  PhaseValue,
  Snapshot,
  SnapshotProduct,
  SnapshotRelease,
  SnapshotSource,
} from './types.js';

export const DATA_LICENCE = 'MIT';
export const DATA_LICENCE_URL = 'https://github.com/endoflife-date/endoflife.date/blob/master/LICENSE';
export const DATA_REPOSITORY = 'https://github.com/endoflife-date/endoflife.date';
export const API_FULL_URL = 'https://endoflife.date/api/v1/products/full';

// ---------------------------------------------------------------------------
// API v1
// ---------------------------------------------------------------------------

interface ApiRelease {
  name: string;
  codename?: string | null;
  label?: string | null;
  releaseDate?: string | null;
  isLts?: boolean | null;
  ltsFrom?: string | null;
  isEoas?: boolean | null;
  eoasFrom?: string | null;
  isEol?: boolean | null;
  eolFrom?: string | null;
  isEoes?: boolean | null;
  eoesFrom?: string | null;
  isDiscontinued?: boolean | null;
  discontinuedFrom?: string | null;
  latest?: { name?: string | null; date?: string | null } | null;
}

interface ApiProduct {
  name: string;
  label: string;
  aliases?: string[] | null;
  category?: string | null;
  labels?: Partial<Record<keyof PhaseLabels, string | null>> | null;
  links?: { html?: string | null; releasePolicy?: string | null } | null;
  releases?: ApiRelease[] | null;
}

export interface ApiFullResponse {
  schema_version?: string;
  generated_at?: string;
  total?: number;
  result: ApiProduct[];
}

/**
 * The API reports each phase as a boolean computed on the day the site was built plus the
 * date, if any. We keep the date when there is one, otherwise the boolean, so that status can
 * be recomputed for any day.
 */
function phaseFromApi(flag: boolean | null | undefined, from: string | null | undefined): PhaseValue | undefined {
  if (isIsoDate(from)) return from;
  if (typeof flag === 'boolean') return flag;
  return undefined;
}

/** Removes the " (LTS)" / " (Upcoming LTS)" suffix the API adds; we recompute LTS ourselves. */
function stripLtsSuffix(label: string): string {
  return label.replace(/\s*\((Upcoming )?LTS\)\s*$/i, '').trim();
}

function compact<T extends object>(obj: T): T {
  for (const key of Object.keys(obj) as (keyof T)[]) {
    if (obj[key] === undefined) delete obj[key];
  }
  return obj;
}

export function releaseFromApi(r: ApiRelease): SnapshotRelease {
  return compact<SnapshotRelease>({
    cycle: String(r.name),
    label: stripLtsSuffix(r.label ?? String(r.name)),
    codename: r.codename || undefined,
    releaseDate: isIsoDate(r.releaseDate) ? r.releaseDate : undefined,
    lts: phaseFromApi(r.isLts, r.ltsFrom),
    eoas: phaseFromApi(r.isEoas, r.eoasFrom),
    eol: phaseFromApi(r.isEol, r.eolFrom),
    eoes: phaseFromApi(r.isEoes, r.eoesFrom),
    discontinued: phaseFromApi(r.isDiscontinued, r.discontinuedFrom),
    latest: r.latest?.name ?? undefined,
    latestDate: isIsoDate(r.latest?.date) ? r.latest.date : undefined,
  });
}

export function productFromApi(p: ApiProduct): SnapshotProduct {
  return compact<SnapshotProduct>({
    name: p.name,
    label: p.label,
    aliases: [...(p.aliases ?? [])],
    category: p.category ?? 'unknown',
    labels: {
      eoas: p.labels?.eoas ?? null,
      eol: p.labels?.eol ?? null,
      eoes: p.labels?.eoes ?? null,
      discontinued: p.labels?.discontinued ?? null,
    },
    link: p.links?.html ?? `https://endoflife.date/${p.name}`,
    releasePolicy: p.links?.releasePolicy ?? undefined,
    releases: (p.releases ?? []).map(releaseFromApi),
  });
}

export function snapshotFromApi(
  response: ApiFullResponse,
  extra: { dataDate: string; createdAt?: string; commit?: string; commitDate?: string; apiUrl?: string },
): Snapshot {
  if (!response || !Array.isArray(response.result)) {
    throw new Error('Unexpected API response: no "result" array.');
  }
  const products = response.result.map(productFromApi).sort((a, b) => a.name.localeCompare(b.name));
  const source: SnapshotSource = compact<SnapshotSource>({
    name: 'endoflife.date',
    method: 'api-v1',
    apiUrl: extra.apiUrl ?? API_FULL_URL,
    apiGeneratedAt: response.generated_at,
    repository: DATA_REPOSITORY,
    commit: extra.commit,
    commitDate: extra.commitDate,
    licence: DATA_LICENCE,
    licenceUrl: DATA_LICENCE_URL,
  });
  return {
    schemaVersion: 1,
    dataDate: extra.dataDate,
    createdAt: extra.createdAt ?? new Date().toISOString(),
    source,
    productCount: products.length,
    products,
  };
}

// ---------------------------------------------------------------------------
// Git repository front matter (products/*.md)
// ---------------------------------------------------------------------------

/** Column defaults from the endoflife.date site configuration (_config.yml). */
const COLUMN_DEFAULTS: Record<keyof PhaseLabels, { enabled: boolean; label: string }> = {
  eoas: { enabled: false, label: 'Active Support' },
  eol: { enabled: true, label: 'Security Support' },
  eoes: { enabled: false, label: 'Extended Support' },
  discontinued: { enabled: false, label: 'Discontinued' },
};

const COLUMN_KEYS: Record<keyof PhaseLabels, string> = {
  eoas: 'eoasColumn',
  eol: 'eolColumn',
  eoes: 'eoesColumn',
  discontinued: 'discontinuedColumn',
};

function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, '').trim();
}

/** Splits a product Markdown file into its YAML front matter. */
export function extractFrontMatter(markdown: string): string {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\s*(\r?\n|$)/.exec(markdown);
  if (!match || match[1] === undefined) throw new Error('No YAML front matter found.');
  return match[1];
}

/**
 * Parses front matter with the YAML "failsafe" schema so every scalar stays a string.
 * This keeps cycles such as "3.10" from turning into the number 3.1.
 */
function parseFailsafe(yamlText: string): Record<string, unknown> {
  const parsed: unknown = parseYaml(yamlText, { schema: 'failsafe' });
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Front matter is not a mapping.');
  }
  return parsed as Record<string, unknown>;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim() : undefined;
}

function phaseFromYaml(value: unknown): PhaseValue | undefined {
  const s = str(value);
  if (s === undefined || s === '') return undefined;
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (isIsoDate(s)) return s;
  return undefined;
}

function columnSetting(fm: Record<string, unknown>, phase: keyof PhaseLabels): string | null {
  const raw = str(fm[COLUMN_KEYS[phase]]);
  const def = COLUMN_DEFAULTS[phase];
  if (raw === undefined) return def.enabled ? def.label : null;
  if (raw === 'false') return null;
  if (raw === 'true') return def.label;
  return stripHtml(raw);
}

/**
 * Renders a cycle label from the product's releaseLabel template. Only the simple placeholders
 * are supported; Liquid expressions fall back to the cycle name.
 */
function renderLabel(template: string | undefined, rel: Record<string, unknown>, cycle: string): string {
  if (!template || /{{|{%/.test(template)) return cycle;
  return stripHtml(
    template
      .replace(/__RELEASE_CYCLE__/g, cycle)
      .replace(/__CODENAME__/g, str(rel.codename) ?? '')
      .replace(/__LATEST__/g, str(rel.latest) ?? ''),
  );
}

export function productFromFrontMatter(fileName: string, markdown: string): SnapshotProduct {
  const fm = parseFailsafe(extractFrontMatter(markdown));
  const permalink = str(fm.permalink) ?? `/${fileName.replace(/\.md$/, '')}`;
  const name = permalink.replace(/^\//, '');
  const alternate = Array.isArray(fm.alternate_urls) ? fm.alternate_urls : [];
  const labels: PhaseLabels = {
    eoas: columnSetting(fm, 'eoas'),
    eol: columnSetting(fm, 'eol'),
    eoes: columnSetting(fm, 'eoes'),
    discontinued: columnSetting(fm, 'discontinued'),
  };
  const latestColumn = str(fm.latestColumn) !== 'false';
  const productLabelTemplate = str(fm.releaseLabel);
  const releasesRaw = Array.isArray(fm.releases) ? fm.releases : [];

  const releases: SnapshotRelease[] = releasesRaw
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
    .map((r) => {
      const cycle = str(r.releaseCycle) ?? '';
      const releaseDate = str(r.releaseDate);
      const latestDate = str(r.latestReleaseDate);
      return compact<SnapshotRelease>({
        cycle,
        label: renderLabel(str(r.releaseLabel) ?? productLabelTemplate, r, cycle),
        codename: str(r.codename) || undefined,
        releaseDate: isIsoDate(releaseDate) ? releaseDate : undefined,
        lts: phaseFromYaml(r.lts) ?? false,
        eoas: labels.eoas ? phaseFromYaml(r.eoas) : undefined,
        eol: phaseFromYaml(r.eol),
        eoes: labels.eoes ? phaseFromYaml(r.eoes) : undefined,
        discontinued: labels.discontinued ? phaseFromYaml(r.discontinued) : undefined,
        latest: latestColumn ? str(r.latest) || undefined : undefined,
        latestDate: latestColumn && isIsoDate(latestDate) ? latestDate : undefined,
      });
    });

  return compact<SnapshotProduct>({
    name,
    label: str(fm.title) ?? name,
    aliases: alternate.map((a) => String(a).replace(/^\//, '')),
    category: str(fm.category) ?? 'unknown',
    labels,
    link: `https://endoflife.date/${name}`,
    releasePolicy: str(fm.releasePolicyLink),
    releases,
  });
}

export function snapshotFromFrontMatter(
  files: { fileName: string; content: string }[],
  extra: { dataDate: string; createdAt?: string; commit?: string; commitDate?: string },
): { snapshot: Snapshot; errors: string[] } {
  const errors: string[] = [];
  const products: SnapshotProduct[] = [];
  for (const f of files) {
    try {
      products.push(productFromFrontMatter(f.fileName, f.content));
    } catch (err) {
      errors.push(`${f.fileName}: ${(err as Error).message}`);
    }
  }
  products.sort((a, b) => a.name.localeCompare(b.name));
  return {
    snapshot: {
      schemaVersion: 1,
      dataDate: extra.dataDate,
      createdAt: extra.createdAt ?? new Date().toISOString(),
      source: compact<SnapshotSource>({
        name: 'endoflife.date',
        method: 'git-front-matter',
        repository: DATA_REPOSITORY,
        commit: extra.commit,
        commitDate: extra.commitDate,
        licence: DATA_LICENCE,
        licenceUrl: DATA_LICENCE_URL,
      }),
      productCount: products.length,
      products,
    },
    errors,
  };
}

// ---------------------------------------------------------------------------
// Serialisation: compact but line-oriented, so Git diffs between snapshots stay readable.
// ---------------------------------------------------------------------------

export function serialiseSnapshot(snapshot: Snapshot): string {
  const lines: string[] = ['{'];
  lines.push(`  "schemaVersion": ${JSON.stringify(snapshot.schemaVersion)},`);
  lines.push(`  "dataDate": ${JSON.stringify(snapshot.dataDate)},`);
  lines.push(`  "createdAt": ${JSON.stringify(snapshot.createdAt)},`);
  lines.push(`  "source": ${JSON.stringify(snapshot.source)},`);
  lines.push(`  "productCount": ${snapshot.productCount},`);
  lines.push('  "products": [');
  snapshot.products.forEach((p, i) => {
    const { releases, ...head } = p;
    const headJson = JSON.stringify(head);
    lines.push(`    ${headJson.slice(0, -1)},"releases":[`);
    releases.forEach((r, j) => {
      lines.push(`      ${JSON.stringify(r)}${j < releases.length - 1 ? ',' : ''}`);
    });
    lines.push(`    ]}${i < snapshot.products.length - 1 ? ',' : ''}`);
  });
  lines.push('  ]');
  lines.push('}');
  return lines.join('\n') + '\n';
}
