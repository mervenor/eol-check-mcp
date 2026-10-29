/** Dockerfile FROM lines and docker-compose image: lines. */
import type { Detection, DetectorResult, FileInput, Precision } from './types.js';

/**
 * Docker Hub / registry image name -> endoflife.date product id. The match is on the last path
 * segment, so "library/node", "docker.io/library/postgres" and "bitnami/postgresql" all work.
 * Microsoft images are matched on their full path.
 */
const IMAGE_PRODUCTS: Record<string, string> = {
  node: 'nodejs',
  python: 'python',
  postgres: 'postgresql',
  postgresql: 'postgresql',
  postgis: 'postgresql',
  mysql: 'mysql',
  'mysql-server': 'mysql',
  mariadb: 'mariadb',
  php: 'php',
  ruby: 'ruby',
  golang: 'go',
  nginx: 'nginx',
  httpd: 'apache-http-server',
  redis: 'redis',
  mongo: 'mongodb',
  mongodb: 'mongodb',
  tomcat: 'tomcat',
  'eclipse-temurin': 'eclipse-temurin',
  'amazoncorretto': 'amazon-corretto',
  alpine: 'alpine-linux',
  debian: 'debian',
  ubuntu: 'ubuntu',
  rabbitmq: 'rabbitmq',
  elasticsearch: 'elasticsearch',
  haproxy: 'haproxy',
  traefik: 'traefik',
  memcached: 'memcached',
};

const MICROSOFT_DOTNET = /^mcr\.microsoft\.com\/dotnet\/(core\/)?(sdk|aspnet|runtime|runtime-deps)$/i;
const MICROSOFT_FRAMEWORK = /^mcr\.microsoft\.com\/dotnet\/framework\/(sdk|aspnet|runtime|wcf)$/i;
const MICROSOFT_MSSQL = /^mcr\.microsoft\.com\/mssql\/server$/i;

export interface ImageRef {
  image: string;
  tag: string;
  digest?: string;
}

/** "docker.io/library/node:18-alpine@sha256:..." -> { image, tag, digest } */
export function parseImageRef(ref: string): ImageRef {
  let rest = ref.trim();
  let digest: string | undefined;
  const at = rest.indexOf('@');
  if (at >= 0) {
    digest = rest.slice(at + 1);
    rest = rest.slice(0, at);
  }
  const lastSlash = rest.lastIndexOf('/');
  const colon = rest.indexOf(':', lastSlash + 1);
  if (colon >= 0) return { image: rest.slice(0, colon), tag: rest.slice(colon + 1), digest };
  return { image: rest, tag: '', digest };
}

/** Version part of a tag: "18.17.1-alpine3.18" -> "18.17.1"; "lts-bullseye" -> "lts". */
export function tagVersion(tag: string): string {
  const m = /^v?(\d+(?:\.\d+)*)/.exec(tag);
  if (m?.[1]) return m[1];
  return tag.split('-')[0] ?? '';
}

/** Docker tags such as "8" or "16" float across later cycles; a tag with a patch level is pinned. */
function tagPrecision(version: string, segmentsForExact: number): Precision {
  return version.split('.').length >= segmentsForExact ? 'exact' : 'floating';
}

interface FromLine {
  line: number;
  ref: string;
  raw: string;
}

/** FROM lines, honouring line continuations and skipping references to earlier build stages. */
export function fromLines(content: string): FromLine[] {
  const logical: { line: number; text: string }[] = [];
  let buf = '';
  let start = 0;
  content.split(/\r?\n/).forEach((l, i) => {
    if (!buf) start = i + 1;
    if (/\\\s*$/.test(l)) {
      buf += l.replace(/\\\s*$/, ' ');
    } else {
      logical.push({ line: start, text: buf + l });
      buf = '';
    }
  });
  if (buf) logical.push({ line: start, text: buf });

  const earlierStages = new Set<string>();
  const out: FromLine[] = [];
  const args: Record<string, string> = {};
  for (const { line, text } of logical) {
    // Global ARG defaults, so "ARG NODE_VERSION=18" + "FROM node:${NODE_VERSION}" resolves.
    const argM = /^\s*ARG\s+([A-Za-z_][A-Za-z0-9_]*)=("?)([^"\s]+)\2/i.exec(text);
    if (argM?.[1] && argM[3]) args[argM[1]] = argM[3];
    const m = /^\s*FROM\s+(?:--platform=\S+\s+)?(\S+)(?:\s+AS\s+(\S+))?/i.exec(text);
    if (!m?.[1]) continue;
    const ref = m[1].replace(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g, (all, name: string) => args[name] ?? all);
    const lower = ref.toLowerCase();
    // "FROM build AS final" names an earlier stage, not an image; "scratch" is empty.
    if (!earlierStages.has(lower) && lower !== 'scratch') {
      out.push({ line, ref, raw: text.trim().replace(/\s+/g, ' ') });
    }
    if (m[2]) earlierStages.add(m[2].toLowerCase());
  }
  return out;
}

/** Maps one image reference to a detection, or explains why it was skipped. */
export function detectImage(ref: string, file: string, evidence: string): { detection?: Detection; note?: string } {
  const { image, tag } = parseImageRef(ref);
  if (ref.includes('$')) return { note: `${file}: ${evidence} uses a build argument we cannot resolve.` };
  const lowerImage = image.toLowerCase();

  if (MICROSOFT_DOTNET.test(lowerImage)) {
    const v = tagVersion(tag);
    if (!v) return { note: `${file}: ${evidence} has no version tag.` };
    const isAspNet = /\/aspnet$/i.test(lowerImage);
    return {
      detection: {
        product: 'dotnet',
        version: v,
        precision: 'exact',
        file,
        evidence,
        component: isAspNet ? 'ASP.NET Core' : undefined,
      },
    };
  }
  if (MICROSOFT_FRAMEWORK.test(lowerImage)) {
    const m = /^(\d+\.\d+(?:\.\d+)?)/.exec(tag);
    if (!m?.[1]) return { note: `${file}: ${evidence} has no .NET Framework version tag.` };
    return { detection: { product: 'dotnetfx', version: m[1], precision: 'exact', file, evidence } };
  }
  if (MICROSOFT_MSSQL.test(lowerImage)) {
    const m = /^(20\d\d)/.exec(tag);
    if (!m?.[1]) return { note: `${file}: ${evidence} has no SQL Server year tag.` };
    return { note: `${file}: ${evidence} is SQL Server ${m[1]}; check it with check_version("mssqlserver", ...).` };
  }

  const name = lowerImage.split('/').pop() ?? '';
  const product = IMAGE_PRODUCTS[name];
  if (!product) return {};
  if (!tag || tag === 'latest') {
    return { note: `${file}: ${evidence} has no pinned version ("${tag || 'latest'}"), so it moves with each release.` };
  }

  // Node codenames and "lts" tags.
  const v = tagVersion(tag);
  if (product === 'nodejs' && /^(lts|current)$/i.test(v)) {
    return { note: `${file}: ${evidence} follows a moving "${v}" tag, so it has no fixed version.` };
  }
  if (product === 'nodejs' && /^[a-z]+$/i.test(v)) {
    return { detection: { product, version: v, precision: 'floating', file, evidence } };
  }
  if (!/^\d/.test(v)) {
    if ((product === 'debian' || product === 'ubuntu') && /^[a-z]+$/i.test(v)) {
      return { detection: { product, version: v, precision: 'exact', file, evidence } };
    }
    return { note: `${file}: ${evidence} tag "${tag}" has no version number.` };
  }

  // How many version segments pin a cycle exactly: Node/MySQL/Postgres etc. differ.
  const exactAt: Record<string, number> = { postgresql: 2, nodejs: 3, python: 3, mysql: 3, mariadb: 3, redis: 3, mongodb: 3, php: 3 };
  return { detection: { product, version: v, precision: tagPrecision(v, exactAt[product] ?? 3), file, evidence } };
}

export function scanDockerfile(file: FileInput): DetectorResult {
  const detections: Detection[] = [];
  const notes: string[] = [];
  for (const f of fromLines(file.content)) {
    const { detection, note } = detectImage(f.ref, file.path, `FROM ${f.ref}`);
    if (detection) detections.push(detection);
    if (note) notes.push(note);
  }
  return { kind: 'Dockerfile', detections, notes };
}

/** docker-compose.yml / compose.yaml: image: lines. */
export function scanCompose(file: FileInput): DetectorResult {
  const detections: Detection[] = [];
  const notes: string[] = [];
  for (const m of file.content.matchAll(/^\s*image:\s*["']?([^"'\s#]+)["']?/gm)) {
    const ref = m[1];
    if (!ref) continue;
    const { detection, note } = detectImage(ref, file.path, `image: ${ref}`);
    if (detection) detections.push(detection);
    if (note) notes.push(note);
  }
  return { kind: 'docker-compose', detections, notes };
}
