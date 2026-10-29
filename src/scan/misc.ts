/** Small version files: .nvmrc, .node-version, .tool-versions. */
import type { Detection, DetectorResult, FileInput } from './types.js';

export function scanNvmrc(file: FileInput, kind: string): DetectorResult {
  const line = file.content.split(/\r?\n/).map((l) => l.replace(/#.*$/, '').trim()).find(Boolean) ?? '';
  if (!line) return { kind, detections: [], notes: [`${file.path}: empty.`] };
  if (/^(node|stable|current|lts\/\*)$/i.test(line)) {
    return { kind, detections: [], notes: [`${file.path}: "${line}" follows the newest release, so it has no fixed version.`] };
  }
  const lts = /^lts\/([a-z]+)$/i.exec(line);
  if (lts?.[1]) {
    return { kind, detections: [{ product: 'nodejs', version: `lts/${lts[1].toLowerCase()}`, precision: 'exact', file: file.path, evidence: line }], notes: [] };
  }
  const m = /^v?(\d+(?:\.\d+){0,2})/.exec(line);
  if (!m?.[1]) return { kind, detections: [], notes: [`${file.path}: unrecognised Node.js version "${line}".`] };
  return { kind, detections: [{ product: 'nodejs', version: m[1], precision: 'exact', file: file.path, evidence: line }], notes: [] };
}

/** asdf / mise .tool-versions: "nodejs 18.19.0", "python 3.11.7". */
export function scanToolVersions(file: FileInput): DetectorResult {
  const detections: Detection[] = [];
  const tools: Record<string, string> = { nodejs: 'nodejs', node: 'nodejs', python: 'python', ruby: 'ruby', golang: 'go', php: 'php', postgres: 'postgresql', dotnet: 'dotnet', 'dotnet-core': 'dotnet' };
  for (const raw of file.content.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const m = /^(\S+)\s+(\S+)/.exec(line);
    if (!m?.[1] || !m[2]) continue;
    const product = tools[m[1].toLowerCase()];
    if (!product || !/^\d/.test(m[2])) continue;
    detections.push({ product, version: m[2], precision: 'exact', file: file.path, evidence: line });
  }
  return { kind: '.tool-versions', detections, notes: [] };
}
