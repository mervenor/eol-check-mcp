/**
 * The questions the tools answer, as plain functions of (catalogue, input, today). The MCP layer
 * only validates input and formats output, so everything here is unit-testable.
 */
import type { Catalogue } from './catalogue.js';
import { formatDate, formatDays } from './dates.js';
import {
  evaluateRelease,
  newestCycle,
  recommendedCycle,
  releasesNewestFirst,
  type CycleStatus,
  type SupportStatus,
  type Urgency,
} from './status.js';
import type { SnapshotProduct, SnapshotRelease } from './types.js';
import { isLatestPatch, resolveCycle, type ResolveMode } from './versions.js';

/**
 * Where a product has no newer cycle because it was replaced by a different product.
 * Kept deliberately short: only well-known, unambiguous successors.
 */
export const SUCCESSORS: Record<string, { product: string; note: string }> = {
  angularjs: { product: 'angular', note: 'AngularJS (1.x) was replaced by Angular (2 and later), which is a rewrite rather than an upgrade.' },
  dotnetfx: { product: 'dotnet', note: '.NET Framework 4.8.1 is the final version; new development moves to modern .NET, which is a migration rather than an upgrade.' },
};

/** A version that fits the other .NET line is checked there ("dotnet 4.8" means .NET Framework 4.8). */
const ALTERNATES: Record<string, string> = { dotnet: 'dotnetfx', dotnetfx: 'dotnet' };

export interface ProductInfo {
  id: string;
  label: string;
  category: string;
  link: string;
  releasePolicy: string | null;
}

export interface CycleRef {
  product: string;
  cycle: string;
  name: string;
  lts: boolean;
  status: SupportStatus;
  releaseDate: string | null;
  securitySupportEnds: string | null;
  latest: string | null;
}

export interface CheckResult {
  found: boolean;
  input: { product: string; version: string; date: string };
  product: ProductInfo | null;
  /** Human name of the detected cycle, for example "Microsoft .NET 8". */
  name: string | null;
  status: SupportStatus | 'not-found';
  urgency: Urgency;
  cycle: CycleStatus | null;
  /** How the version was matched to a cycle ("newest" means the version spans several cycles and we took the newest). */
  matchedBy: 'exact' | 'codename' | 'prefix' | 'newest' | null;
  /** True when the version is older than every cycle endoflife.date tracks; we infer end of life. */
  olderThanTracked: boolean;
  versionIsLatestInCycle: boolean | null;
  latestInCycle: string | null;
  newestCycle: CycleRef | null;
  recommendedUpgrade: CycleRef | null;
  successor: { product: string; note: string; recommended: CycleRef | null } | null;
  /** Cycles the version could mean, when it is not specific enough. */
  candidates: string[];
  /** Product ids that look like what was meant, when the product was not found. */
  suggestions: string[];
  summary: string;
}

export function productInfo(p: SnapshotProduct): ProductInfo {
  return { id: p.name, label: p.label, category: p.category, link: p.link, releasePolicy: p.releasePolicy ?? null };
}

/** "Microsoft .NET 8", "Node.js 20", "Ubuntu 22.04 'Jammy Jellyfish'". */
export function cycleName(product: SnapshotProduct, release: Pick<SnapshotRelease, 'label' | 'cycle'>): string {
  const label = release.label || release.cycle;
  return `${product.label} ${label}`;
}

export function cycleRef(product: SnapshotProduct, release: SnapshotRelease, today: string): CycleRef {
  const s = evaluateRelease(release, today);
  return {
    product: product.name,
    cycle: release.cycle,
    name: cycleName(product, release) + (s.lts ? ' (LTS)' : ''),
    lts: s.lts,
    status: s.status,
    releaseDate: s.releaseDate,
    securitySupportEnds: s.securitySupportEnds,
    latest: s.latest,
  };
}

function emptyResult(input: CheckResult['input']): CheckResult {
  return {
    found: false,
    input,
    product: null,
    name: null,
    status: 'not-found',
    urgency: 'unknown',
    cycle: null,
    matchedBy: null,
    olderThanTracked: false,
    versionIsLatestInCycle: null,
    latestInCycle: null,
    newestCycle: null,
    recommendedUpgrade: null,
    successor: null,
    candidates: [],
    suggestions: [],
    summary: '',
  };
}

/** One sentence on the cycle's status, for example "... is supported until 10 November 2026 (13 days left)." */
export function statusSentence(name: string, s: CycleStatus): string {
  const eol = s.securitySupportEnds;
  switch (s.status) {
    case 'end-of-life':
      return eol
        ? `${name} reached end of life on ${formatDate(eol)} (${formatDays(s.daysOverdue ?? 0)} ago).`
        : `${name} is end of life.`;
    case 'security-only': {
      const since = s.activeSupportEnds ? ` since ${formatDate(s.activeSupportEnds)}` : '';
      if (!eol) return `${name} receives security fixes only${since}; no end date is published.`;
      return s.daysRemaining === 0
        ? `${name} receives security fixes only${since}; today, ${formatDate(eol)}, is the last day of support.`
        : `${name} receives security fixes only${since}, until ${formatDate(eol)} (${formatDays(s.daysRemaining ?? 0)} left).`;
    }
    case 'supported':
      if (!eol) return `${name} is supported; no end date is published yet.`;
      return s.daysRemaining === 0
        ? `${name} is supported, but today, ${formatDate(eol)}, is the last day of support.`
        : `${name} is supported until ${formatDate(eol)} (${formatDays(s.daysRemaining ?? 0)} left).`;
    default:
      return `endoflife.date publishes no support dates for ${name}.`;
  }
}

function upgradeSentence(result: CheckResult): string {
  const rec = result.recommendedUpgrade;
  const cyc = result.cycle;
  if (!cyc) return '';
  const succ = result.successor;
  const succText = succ ? `${succ.note}${succ.recommended ? ` Current target: ${succ.recommended.name}.` : ''}` : '';
  if (!rec) return succ ? ` ${succText}` : ' No supported cycle of this product is listed.';
  let out: string;
  if (rec.cycle === cyc.cycle) {
    out =
      result.versionIsLatestInCycle === false && result.latestInCycle
        ? ` This is the recommended cycle; update to the latest patch, ${result.latestInCycle}.`
        : ' This is the recommended cycle.';
  } else {
    const ends = rec.securitySupportEnds ? `, supported until ${formatDate(rec.securitySupportEnds)}` : '';
    out = ` Recommended upgrade: ${rec.name}${ends}.`;
  }
  return succ ? `${out} Longer term: ${succText}` : out;
}

export function checkVersion(
  catalogue: Catalogue,
  productQuery: string,
  version: string,
  today: string,
  mode: ResolveMode = 'exact',
  allowAlternate = true,
): CheckResult {
  const result = emptyResult({ product: productQuery, version, date: today });
  const product = catalogue.find(productQuery);
  if (!product) {
    result.suggestions = catalogue.suggest(productQuery);
    result.summary =
      `endoflife.date has no product called "${productQuery}".` +
      (result.suggestions.length ? ` Did you mean: ${result.suggestions.join(', ')}?` : ' Use list_products to search.');
    return result;
  }

  result.found = true;
  result.product = productInfo(product);
  const newest = newestCycle(product, today);
  const recommended = recommendedCycle(product, today);
  result.newestCycle = newest ? cycleRef(product, newest, today) : null;
  result.recommendedUpgrade = recommended ? cycleRef(product, recommended, today) : null;
  const succ = SUCCESSORS[product.name];
  if (succ) {
    const sp = catalogue.get(succ.product);
    const sr = sp ? recommendedCycle(sp, today) : undefined;
    result.successor = { product: succ.product, note: succ.note, recommended: sp && sr ? cycleRef(sp, sr, today) : null };
  }

  const resolution = resolveCycle(product, version, mode);
  if (resolution.kind === 'ambiguous') {
    result.status = 'unknown';
    result.candidates = resolution.candidates;
    result.summary = `"${version}" could mean several ${product.label} cycles (${resolution.candidates.join(', ')}). Give a more specific version.`;
    return result;
  }
  if (resolution.kind === 'none') {
    const alt = allowAlternate ? catalogue.get(ALTERNATES[product.name] ?? '') : undefined;
    if (alt && resolveCycle(alt, version, mode).kind === 'match') {
      const r = checkVersion(catalogue, alt.name, version, today, mode, false);
      r.input.product = productQuery;
      r.summary = `"${version}" is a ${alt.label} version, so we checked that. ${r.summary}`;
      return r;
    }
    result.status = 'unknown';
    result.summary = `"${version}" does not match any ${product.label} release cycle tracked by endoflife.date (cycles: ${releasesNewestFirst(product)
      .slice(0, 8)
      .map((r) => r.cycle)
      .join(', ')}${product.releases.length > 8 ? ', ...' : ''}).`;
    return result;
  }

  if (resolution.kind === 'older-than-tracked') {
    const oldest = evaluateRelease(resolution.oldest, today);
    result.olderThanTracked = true;
    if (oldest.status === 'end-of-life') {
      result.status = 'end-of-life';
      result.urgency = 'critical';
      result.name = `${product.label} ${resolution.normalised}`;
      result.cycle = null;
      result.summary =
        `${result.name} is older than the oldest cycle endoflife.date tracks (${resolution.oldest.cycle}, end of life ${
          oldest.securitySupportEnds ? formatDate(oldest.securitySupportEnds) : 'already'
        }), so it is end of life.` + (result.recommendedUpgrade ? ` Recommended upgrade: ${result.recommendedUpgrade.name}.` : '');
      return result;
    }
    result.status = 'unknown';
    result.summary = `${product.label} ${resolution.normalised} is older than every cycle endoflife.date tracks.`;
    return result;
  }

  const release = resolution.release;
  const s = evaluateRelease(release, today);
  result.cycle = s;
  result.matchedBy = resolution.matchedBy;
  result.status = s.status;
  result.urgency = s.urgency;
  result.name = cycleName(product, release) + (s.lts ? ' (LTS)' : '');
  result.latestInCycle = s.latest;
  result.versionIsLatestInCycle = isLatestPatch(resolution.normalised, release.latest);

  let summary = statusSentence(result.name, s);
  if (s.releaseDate && s.releaseDate > today) summary = `${result.name} is not released until ${formatDate(s.releaseDate)}. ${summary}`;
  if (s.status === 'end-of-life' && s.extendedSupport === 'available') {
    const label = product.labels.eoes ?? 'Extended support';
    summary += ` ${label} is still available${s.extendedSupportEnds ? ` until ${formatDate(s.extendedSupportEnds)}` : ''}.`;
  }
  summary += upgradeSentence(result);
  result.summary = summary;
  return result;
}

export interface CyclesResult {
  found: boolean;
  product: ProductInfo | null;
  date: string;
  labels: SnapshotProduct['labels'] | null;
  newestCycle: CycleRef | null;
  recommendedUpgrade: CycleRef | null;
  cycles: CycleStatus[];
  suggestions: string[];
  summary: string;
}

export function getCycles(catalogue: Catalogue, productQuery: string, today: string, limit?: number): CyclesResult {
  const product = catalogue.find(productQuery);
  if (!product) {
    const suggestions = catalogue.suggest(productQuery);
    return {
      found: false,
      product: null,
      date: today,
      labels: null,
      newestCycle: null,
      recommendedUpgrade: null,
      cycles: [],
      suggestions,
      summary: `endoflife.date has no product called "${productQuery}".${suggestions.length ? ` Did you mean: ${suggestions.join(', ')}?` : ''}`,
    };
  }
  const all = releasesNewestFirst(product).map((r) => evaluateRelease(r, today));
  const cycles = limit && limit > 0 ? all.slice(0, limit) : all;
  const newest = newestCycle(product, today);
  const rec = recommendedCycle(product, today);
  const supported = all.filter((c) => c.status === 'supported' || c.status === 'security-only');
  const parts = [`${product.label}: ${all.length} cycles tracked, ${supported.length} still supported on ${formatDate(today)}.`];
  if (rec) parts.push(`Recommended: ${cycleRef(product, rec, today).name}.`);
  return {
    found: true,
    product: productInfo(product),
    date: today,
    labels: product.labels,
    newestCycle: newest ? cycleRef(product, newest, today) : null,
    recommendedUpgrade: rec ? cycleRef(product, rec, today) : null,
    cycles,
    suggestions: [],
    summary: parts.join(' '),
  };
}

export interface ListResult {
  total: number;
  returned: number;
  products: { id: string; label: string; category: string; aliases: string[]; cycles: number }[];
  categories: string[];
}

export function listProducts(catalogue: Catalogue, query?: string, category?: string, limit = 100): ListResult {
  const matches = catalogue.search(query, category);
  const products = matches.slice(0, limit).map((p) => ({
    id: p.name,
    label: p.label,
    category: p.category,
    aliases: p.aliases,
    cycles: p.releases.length,
  }));
  return { total: matches.length, returned: products.length, products, categories: catalogue.categories() };
}
