/**
 * The MCP server: four read-only tools over the bundled endoflife.date snapshot.
 * Each tool returns a short text answer plus the full result as structured content.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { Catalogue } from './catalogue.js';
import { checkVersion, getCycles, listProducts } from './check.js';
import { isIsoDate, todayIso } from './dates.js';
import { scanProject, SUPPORTED_FILES } from './scan/index.js';
import type { Snapshot } from './types.js';

export const SERVER_NAME = 'eol-check-mcp';
export const SERVER_VERSION = '0.1.0';

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

const dateParam = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a calendar date in the form YYYY-MM-DD.')
  .refine(isIsoDate, 'Not a valid calendar date.')
  .optional()
  .describe('Date to evaluate support on, as YYYY-MM-DD. Defaults to today. Use it for "will this still be supported on ...?" questions.');

export interface ServerOptions {
  /** Fixed "today" for tests; otherwise the real date (or EOL_CHECK_TODAY). */
  today?: () => string;
}

function text(result: { summary: string }, extra?: string): { type: 'text'; text: string }[] {
  return [{ type: 'text', text: extra ? `${result.summary}\n\n${extra}` : result.summary }];
}

export function createServer(snapshot: Snapshot, options: ServerOptions = {}): McpServer {
  const catalogue = new Catalogue(snapshot);
  const today = options.today ?? (() => todayIso());
  const dataNote = `Data: endoflife.date snapshot of ${snapshot.dataDate} (MIT licence).`;

  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions:
        'Answers "is this stack still supported and what should we upgrade first?" from a bundled endoflife.date snapshot. ' +
        'Use scan_project when you have project files, check_version for a single product and version, get_cycles to see a ' +
        'product\'s release schedule and list_products to find a product id. Dates are calendar dates; a support end date is ' +
        `the last supported day. ${dataNote}`,
    },
  );

  server.registerTool(
    'list_products',
    {
      title: 'List products',
      description:
        'Lists the products in the endoflife.date snapshot (runtimes, frameworks, databases, operating systems and more), ' +
        'with their ids for use in the other tools. Filter by a search text and/or category.',
      inputSchema: {
        query: z.string().optional().describe('Text to search in product ids, names and aliases, for example "net", "angular" or "postgres".'),
        category: z
          .string()
          .optional()
          .describe('Only this category: framework, lang, database, os, server-app, app, service, device or standard.'),
        limit: z.number().int().min(1).max(500).optional().describe('Maximum number of products to return (default 100).'),
      },
      annotations: { title: 'List products', ...READ_ONLY },
    },
    async ({ query, category, limit }) => {
      const r = listProducts(catalogue, query, category, limit ?? 100);
      const head =
        r.total === 0
          ? `No products match${query ? ` "${query}"` : ''}${category ? ` in category ${category}` : ''}.`
          : `${r.total} product${r.total === 1 ? '' : 's'}${query ? ` matching "${query}"` : ''}${category ? ` in ${category}` : ''}` +
            (r.returned < r.total ? ` (showing ${r.returned})` : '') +
            ':\n' +
            r.products.map((p) => `- ${p.id}: ${p.label} (${p.category})`).join('\n');
      return { content: [{ type: 'text', text: `${head}\n\n${dataNote}` }], structuredContent: { ...r, dataDate: snapshot.dataDate } };
    },
  );

  server.registerTool(
    'get_cycles',
    {
      title: 'Get release cycles',
      description:
        'Returns every release cycle of a product, newest first, with release date, LTS flag, end of active support, ' +
        'end of security support (end of life), status on the given date, days remaining or overdue, and the latest patch version.',
      inputSchema: {
        product: z.string().min(1).describe('Product id or common name, for example "dotnet", ".NET", "nodejs", "angularjs", "postgres".'),
        date: dateParam,
        limit: z.number().int().min(1).max(500).optional().describe('Only the newest N cycles.'),
      },
      annotations: { title: 'Get release cycles', ...READ_ONLY },
    },
    async ({ product, date, limit }) => {
      const r = getCycles(catalogue, product, date ?? today(), limit);
      if (!r.found) return { content: text(r), structuredContent: { ...r, dataDate: snapshot.dataDate }, isError: true };
      const lines = r.cycles.map((c) => {
        const end = c.securitySupportEnds ?? (c.status === 'end-of-life' ? 'ended' : 'no date');
        return `- ${c.label}${c.lts ? ' (LTS)' : ''}: ${c.status}, support ends ${end}${c.latest ? `, latest ${c.latest}` : ''}`;
      });
      return {
        content: text(r, `${lines.join('\n')}\n\n${dataNote}`),
        structuredContent: { ...r, dataDate: snapshot.dataDate },
      };
    },
  );

  server.registerTool(
    'check_version',
    {
      title: 'Check a version',
      description:
        'Checks one product version: supported, security-only or end-of-life on the given date, with the end dates, days ' +
        'remaining or overdue, the latest patch in that cycle, the newest cycle and the recommended upgrade. Accepts versions ' +
        'as people write them: "8", "8.0.11", "net8.0", "net472", "4.8", "v18.19.0", "lts/hydrogen", "3.12".',
      inputSchema: {
        product: z.string().min(1).describe('Product id or common name, for example "dotnet", "dotnetfx", "nodejs", "python", "angularjs".'),
        version: z.string().min(1).describe('Version or release cycle, for example "8", "6.0.25", "net6.0", "net48", "1.8.2", "3.9".'),
        date: dateParam,
      },
      annotations: { title: 'Check a version', ...READ_ONLY },
    },
    async ({ product, version, date }) => {
      const r = checkVersion(catalogue, product, version, date ?? today());
      return {
        content: text(r, dataNote),
        structuredContent: { ...r, dataDate: snapshot.dataDate },
        isError: !r.found,
      };
    },
  );

  server.registerTool(
    'scan_project',
    {
      title: 'Scan project files',
      description:
        'Reads project files you pass in (contents, not paths on disk) and reports every runtime and framework it detects ' +
        '(Node.js, .NET and .NET Framework, ASP.NET Core, AngularJS, Angular, React, Next.js, Vue, Python, Django, ' +
        'PostgreSQL, MySQL and more) with its support status, sorted most urgent first, plus a one-paragraph summary. ' +
        `Supported files: ${SUPPORTED_FILES.join(', ')}.`,
      inputSchema: {
        files: z
          .array(
            z.object({
              path: z.string().min(1).describe('File name or path, for example "package.json" or "src/Web/Web.csproj". The name decides how it is read.'),
              content: z.string().describe('Full text content of the file.'),
            }),
          )
          .min(1)
          .max(200)
          .describe('Project files to scan.'),
        date: dateParam,
      },
      annotations: { title: 'Scan project files', ...READ_ONLY },
    },
    async ({ files, date }) => {
      const r = scanProject(catalogue, files, date ?? today());
      const lines = r.findings.map(
        (f, i) => `${i + 1}. [${f.urgency}] ${f.name}: ${f.status}${f.securitySupportEnds ? ` (support ends ${f.securitySupportEnds})` : ''}`,
      );
      const notes = r.notes.length ? `\n\nNotes:\n${r.notes.map((n) => `- ${n}`).join('\n')}` : '';
      return {
        content: text(r, `${lines.join('\n')}${notes}\n\n${dataNote}`),
        structuredContent: { ...r },
      };
    },
  );

  return server;
}
