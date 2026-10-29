/**
 * What part a product plays in an application. Used as a secondary sort key in scan_project, so
 * that among equally urgent findings, platforms (runtimes, frameworks, databases) come before
 * front-end libraries and developer tooling.
 */
export type Role = 'runtime' | 'framework' | 'database' | 'os' | 'server' | 'library' | 'tooling' | 'other';

const ROLES: Record<string, Role> = {
  nodejs: 'runtime',
  dotnet: 'runtime',
  dotnetfx: 'runtime',
  python: 'runtime',
  php: 'runtime',
  go: 'runtime',
  ruby: 'runtime',
  'eclipse-temurin': 'runtime',
  'amazon-corretto': 'runtime',
  deno: 'runtime',
  bun: 'runtime',
  angularjs: 'framework',
  angular: 'framework',
  react: 'framework',
  nextjs: 'framework',
  vue: 'framework',
  nuxt: 'framework',
  svelte: 'framework',
  emberjs: 'framework',
  express: 'framework',
  electron: 'framework',
  ionic: 'framework',
  'react-native': 'framework',
  django: 'framework',
  wagtail: 'framework',
  postgresql: 'database',
  mysql: 'database',
  mariadb: 'database',
  mssqlserver: 'database',
  mongodb: 'database',
  redis: 'database',
  elasticsearch: 'database',
  memcached: 'database',
  'alpine-linux': 'os',
  debian: 'os',
  ubuntu: 'os',
  nginx: 'server',
  'apache-http-server': 'server',
  tomcat: 'server',
  haproxy: 'server',
  traefik: 'server',
  rabbitmq: 'server',
  jquery: 'library',
  'jquery-ui': 'library',
  bootstrap: 'library',
  'tailwind-css': 'library',
  numpy: 'library',
  eslint: 'tooling',
  'ansible-core': 'tooling',
};

const ROLE_WEIGHT: Record<Role, number> = {
  runtime: 0,
  framework: 0,
  database: 0,
  os: 0,
  server: 0,
  other: 1,
  library: 1,
  tooling: 2,
};

export function roleOf(product: string): Role {
  return ROLES[product] ?? 'other';
}

export function roleWeight(product: string): number {
  return ROLE_WEIGHT[roleOf(product)];
}
