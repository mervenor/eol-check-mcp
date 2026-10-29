/**
 * Product lookup: resolves the many ways people name a product ("Node", "node.js", ".NET 8",
 * "ASP.NET Core", "postgres") to an endoflife.date product id.
 */
import type { Snapshot, SnapshotProduct } from './types.js';

/** Extra names we accept on top of endoflife.date's own ids and aliases. */
const SYNONYMS: Record<string, string> = {
  net: 'dotnet',
  netcore: 'dotnet',
  dotnetcore: 'dotnet',
  netcoreapp: 'dotnet',
  aspnetcore: 'dotnet',
  aspnet: 'dotnet',
  netframework: 'dotnetfx',
  dotnetframework: 'dotnetfx',
  microsoftnetframework: 'dotnetfx',
  netfx: 'dotnetfx',
  angularjs: 'angularjs',
  angular1: 'angularjs',
  angularjs1: 'angularjs',
  node: 'nodejs',
  nodejs: 'nodejs',
  next: 'nextjs',
  vuejs: 'vue',
  reactjs: 'react',
  postgres: 'postgresql',
  postgressql: 'postgresql',
  mysqlserver: 'mysql',
  sqlserver: 'mssqlserver',
  python3: 'python',
  cpython: 'python',
  golang: 'go',
  emberjs: 'emberjs',
  alpine: 'alpine-linux',
  temurin: 'eclipse-temurin',
};

/** Lower-case and drop everything but letters and digits. */
export function normaliseName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function levenshtein(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length]!;
}

export class Catalogue {
  readonly products: SnapshotProduct[];
  private readonly byKey = new Map<string, SnapshotProduct>();
  private readonly byName = new Map<string, SnapshotProduct>();

  constructor(readonly snapshot: Snapshot) {
    this.products = snapshot.products;
    for (const p of this.products) this.byName.set(p.name, p);
    // Exact ids first, then aliases, then labels: earlier entries win.
    for (const p of this.products) this.addKey(p.name, p);
    for (const p of this.products) for (const a of p.aliases) this.addKey(a, p);
    for (const p of this.products) this.addKey(p.label, p);
    for (const [syn, target] of Object.entries(SYNONYMS)) {
      const p = this.byName.get(target);
      if (p) this.addKey(syn, p);
    }
  }

  private addKey(key: string, p: SnapshotProduct): void {
    const k = normaliseName(key);
    if (k && !this.byKey.has(k)) this.byKey.set(k, p);
  }

  get(name: string): SnapshotProduct | undefined {
    return this.byName.get(name);
  }

  /** Finds a product by id, alias, label or common synonym. */
  find(query: string): SnapshotProduct | undefined {
    const raw = query.trim().toLowerCase();
    const exact = this.byName.get(raw);
    if (exact) return exact;
    return this.byKey.get(normaliseName(raw));
  }

  /** Up to `max` product ids that look like what the caller meant. */
  suggest(query: string, max = 5): string[] {
    const q = normaliseName(query);
    if (!q) return [];
    const scored: { name: string; score: number }[] = [];
    for (const p of this.products) {
      const keys = [p.name, p.label, ...p.aliases].map(normaliseName);
      let best = Number.POSITIVE_INFINITY;
      for (const k of keys) {
        if (k.includes(q) || (k.length >= 3 && q.includes(k))) best = Math.min(best, Math.abs(k.length - q.length) / 100);
        else best = Math.min(best, levenshtein(q, k));
      }
      if (best <= (q.length <= 4 ? 1 : 2)) scored.push({ name: p.name, score: best });
    }
    return scored
      .sort((a, b) => a.score - b.score || a.name.localeCompare(b.name))
      .slice(0, max)
      .map((s) => s.name);
  }

  /** Products whose id, alias, label or category contains the query (all products when empty). */
  search(query?: string, category?: string): SnapshotProduct[] {
    const q = query ? normaliseName(query) : '';
    const synonymTarget = q ? SYNONYMS[q] : undefined;
    return this.products.filter((p) => {
      if (category && p.category.toLowerCase() !== category.toLowerCase()) return false;
      if (!q) return true;
      if (synonymTarget === p.name) return true;
      return [p.name, p.label, ...p.aliases].some((k) => normaliseName(k).includes(q));
    });
  }

  categories(): string[] {
    return [...new Set(this.products.map((p) => p.category))].sort();
  }
}
