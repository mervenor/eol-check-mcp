/**
 * Deterministic evaluation runner (no language model). For each case in eval/cases.json it calls
 * the named tool through a real MCP client, against the bundled snapshot and a fixed date, and
 * checks every expected fact. Prints one line per case and a final score.
 *
 *   npm run eval              # all cases
 *   npm run eval -- --verbose # also print the answer text
 *
 * Exit code is 0 only when every check passes.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUNDLED_SNAPSHOT_PATH, readSnapshotFile } from '../src/data.js';
import { createServer } from '../src/server.js';

interface Case {
  id: string;
  question: string;
  tool: string;
  args?: Record<string, unknown>;
  fixture?: string;
  files?: { path: string; content: string }[];
  expect: Record<string, unknown>;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const verbose = process.argv.includes('--verbose');

function readFixture(name: string): { path: string; content: string }[] {
  const root = path.join(here, 'fixtures', name);
  const walk = (dir: string): { path: string; content: string }[] =>
    readdirSync(dir)
      .sort()
      .flatMap((f) => {
        const p = path.join(dir, f);
        return statSync(p).isDirectory() ? walk(p) : [{ path: path.relative(root, p).split(path.sep).join('/'), content: readFileSync(p, 'utf8') }];
      });
  return walk(root);
}

function get(obj: unknown, dotted: string): unknown {
  return dotted.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj);
}

function matches(item: Record<string, unknown>, want: Record<string, unknown>): boolean {
  return Object.entries(want).every(([k, v]) => item[k] === v);
}

function checkFacts(result: Record<string, unknown>, text: string, expect: Record<string, unknown>): string[] {
  const failures: string[] = [];
  const fail = (m: string) => failures.push(m);
  const list = (key: string) => (Array.isArray(result[key]) ? (result[key] as Record<string, unknown>[]) : []);

  for (const [key, want] of Object.entries(expect)) {
    switch (key) {
      case 'summaryContains':
        for (const s of want as string[]) if (!String(result.summary ?? '').includes(s)) fail(`summary lacks "${s}"`);
        break;
      case 'notesContain':
        for (const s of want as string[]) if (!list('notes').some((n) => String(n).includes(s))) fail(`notes lack "${s}"`);
        break;
      case 'candidatesInclude':
        for (const c of want as string[]) if (!(result.candidates as string[] | undefined)?.includes(c)) fail(`candidates lack ${c}`);
        break;
      case 'suggestionsInclude':
        for (const c of want as string[]) if (!(result.suggestions as string[] | undefined)?.includes(c)) fail(`suggestions lack ${c}`);
        break;
      case 'productsInclude':
        for (const id of want as string[]) if (!list('products').some((p) => p.id === id)) fail(`products lack ${id}`);
        break;
      case 'cyclesInclude':
        for (const w of want as Record<string, unknown>[]) if (!list('cycles').some((c) => matches(c, w))) fail(`no cycle matching ${JSON.stringify(w)}`);
        break;
      case 'findingsInclude':
        for (const w of want as Record<string, unknown>[]) if (!list('findings').some((f) => matches(f, w))) fail(`no finding matching ${JSON.stringify(w)}`);
        break;
      case 'findingsExclude':
        for (const w of want as Record<string, unknown>[]) if (list('findings').some((f) => matches(f, w))) fail(`unexpected finding ${JSON.stringify(w)}`);
        break;
      case 'findingsCount':
        if (list('findings').length !== want) fail(`findings count ${list('findings').length}, expected ${String(want)}`);
        break;
      case 'countsEndOfLife':
        if (get(result, 'counts.end-of-life') !== want) fail(`end-of-life count ${String(get(result, 'counts.end-of-life'))}, expected ${String(want)}`);
        break;
      default: {
        const actual = key.startsWith('first.') ? get(list('findings')[0], key.slice(6)) : get(result, key);
        if (actual !== want) fail(`${key} = ${JSON.stringify(actual)}, expected ${JSON.stringify(want)}`);
      }
    }
  }
  if (!text.trim()) fail('empty text answer');
  return failures;
}

async function main(): Promise<void> {
  const spec = JSON.parse(readFileSync(path.join(here, 'cases.json'), 'utf8')) as { today: string; cases: Case[] };
  const snapshot = readSnapshotFile(BUNDLED_SNAPSHOT_PATH);
  const server = createServer(snapshot, { today: () => spec.today });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'eol-check-eval', version: '1.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  const toolNames = new Set((await client.listTools()).tools.map((t) => t.name));
  let passedCases = 0;
  let passedChecks = 0;
  let totalChecks = 0;

  console.log(`eol-check-mcp evaluation: ${spec.cases.length} cases, today = ${spec.today}, data = ${snapshot.dataDate}\n`);
  for (const c of spec.cases) {
    const failures: string[] = [];
    const checks = Object.entries(c.expect).reduce((n, [, v]) => n + (Array.isArray(v) ? v.length : 1), 0) + 1;
    totalChecks += checks;
    if (!toolNames.has(c.tool)) {
      failures.push(`tool ${c.tool} is not exposed`);
    } else {
      const args = c.tool === 'scan_project' ? { files: c.files ?? readFixture(c.fixture ?? '') } : (c.args ?? {});
      const res = (await client.callTool({ name: c.tool, arguments: args })) as {
        content: { type: string; text: string }[];
        structuredContent?: Record<string, unknown>;
      };
      const text = res.content.map((x) => x.text).join('\n');
      failures.push(...checkFacts(res.structuredContent ?? {}, text, c.expect));
      if (verbose) console.log(`    ${text.split('\n')[0]}`);
    }
    const ok = failures.length === 0;
    if (ok) passedCases += 1;
    passedChecks += checks - Math.min(failures.length, checks);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.id.padEnd(32)} ${c.tool}`);
    for (const f of failures) console.log(`      - ${f}`);
  }

  await client.close();
  const pct = (n: number, d: number) => ((100 * n) / d).toFixed(1);
  console.log(`\nScore: ${passedCases}/${spec.cases.length} cases (${pct(passedCases, spec.cases.length)}%), ${passedChecks}/${totalChecks} checks (${pct(passedChecks, totalChecks)}%)`);
  process.exitCode = passedCases === spec.cases.length ? 0 : 1;
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
