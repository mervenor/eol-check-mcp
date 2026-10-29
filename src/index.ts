#!/usr/bin/env node
/**
 * Entry point.
 *   eol-check-mcp            start the MCP server on stdio (what MCP clients run)
 *   eol-check-mcp refresh    download fresh endoflife.date data into the user cache
 *   eol-check-mcp info       show which snapshot is in use
 *   eol-check-mcp --version  print the version
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { parseArgs } from 'node:util';
import { defaultCachePath, loadSnapshot } from './data.js';
import { refreshSnapshot, type RefreshSource } from './refresh.js';
import { createServer, SERVER_VERSION } from './server.js';

const HELP = `eol-check-mcp ${SERVER_VERSION}
MCP server: is this project's stack still supported, and what should we upgrade first?

Usage:
  eol-check-mcp                     Start the MCP server on stdio.
  eol-check-mcp refresh [options]   Download fresh endoflife.date data.
      --source auto|api|git         Where to get it (default auto: API, then Git).
      --out <file>                  Where to write it (default: user cache).
  eol-check-mcp info                Show the data in use.
  eol-check-mcp --version | --help

Environment:
  EOL_CHECK_SNAPSHOT=<file>         Use this snapshot file instead.
  EOL_CHECK_TODAY=YYYY-MM-DD        Evaluate as if today were this date.
`;

async function main(argv: string[]): Promise<void> {
  const command = argv[0];

  if (command === '--version' || command === '-v') {
    console.log(SERVER_VERSION);
    return;
  }
  if (command === '--help' || command === '-h' || command === 'help') {
    console.log(HELP);
    return;
  }

  if (command === 'info') {
    const { snapshot, path, origin } = loadSnapshot();
    console.log(
      JSON.stringify(
        { version: SERVER_VERSION, snapshot: path, origin, dataDate: snapshot.dataDate, products: snapshot.productCount, source: snapshot.source },
        null,
        2,
      ),
    );
    return;
  }

  if (command === 'refresh') {
    const { values } = parseArgs({
      args: argv.slice(1),
      options: { source: { type: 'string', default: 'auto' }, out: { type: 'string' } },
    });
    const source = values.source as RefreshSource;
    if (!['auto', 'api', 'git'].includes(source)) throw new Error(`Unknown --source "${source}". Use auto, api or git.`);
    const out = values.out ?? defaultCachePath();
    const result = await refreshSnapshot({ source, out, log: (m) => console.error(m) });
    for (const w of result.warnings) console.error(`warning: ${w}`);
    console.log(`Snapshot of ${result.snapshot.dataDate} (${result.snapshot.productCount} products) saved to ${out}`);
    return;
  }

  if (command !== undefined) {
    console.error(`Unknown command "${command}".\n\n${HELP}`);
    process.exitCode = 2;
    return;
  }

  // stdout belongs to the MCP protocol: log to stderr only.
  const { snapshot, origin } = loadSnapshot();
  const server = createServer(snapshot);
  await server.connect(new StdioServerTransport());
  console.error(`eol-check-mcp ${SERVER_VERSION} ready (endoflife.date data of ${snapshot.dataDate}, ${origin}).`);
}

main(process.argv.slice(2)).catch((err: unknown) => {
  console.error(`eol-check-mcp: ${(err as Error).message}`);
  process.exit(1);
});
