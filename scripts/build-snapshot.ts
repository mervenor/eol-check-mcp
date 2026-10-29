/**
 * Maintainer script: rebuilds the bundled snapshot (data/snapshot.json).
 *
 *   npm run snapshot                       # API first, Git repository as fallback
 *   npm run snapshot -- --source git       # Git repository only
 *   npm run snapshot -- --git-dir ../endoflife.date --out /tmp/s.json
 *
 * End users refresh their own copy with `eol-check-mcp refresh` instead.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { refreshSnapshot, type RefreshSource } from '../src/refresh.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const { values } = parseArgs({
  options: {
    source: { type: 'string', default: 'auto' },
    out: { type: 'string', default: path.join(root, 'data', 'snapshot.json') },
    'git-dir': { type: 'string' },
  },
});

const source = values.source as RefreshSource;
if (!['auto', 'api', 'git'].includes(source)) {
  console.error(`Unknown --source "${source}". Use auto, api or git.`);
  process.exit(2);
}

try {
  const result = await refreshSnapshot({
    source,
    out: values.out,
    gitDir: values['git-dir'],
    log: (m) => console.error(m),
  });
  for (const w of result.warnings) console.error(`warning: ${w}`);
  console.log(JSON.stringify({ out: result.out, dataDate: result.snapshot.dataDate, source: result.snapshot.source }, null, 2));
} catch (err) {
  console.error(`Snapshot build failed: ${(err as Error).message}`);
  process.exit(1);
}
