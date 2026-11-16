# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed

- The server reported its version as 0.1.0 in the published 0.1.1 package (`SERVER_VERSION` was not bumped). Fixed in source; the next release carries it.

### Changed

- README: install from npm with `npx -y eol-check-mcp`; building from source stays as an option.

## [0.1.1] - 2026-11-16

### Changed

- Package metadata: published to npm and listed in the official MCP Registry as `com.mervenor/eol-check-mcp` (`mcpName` in `package.json`, `server.json` added). No change to the server's behaviour.

## [0.1.0] - 2026-10-29

First release, built and tested locally. Not yet published to npm.

### Added

- MCP server on stdio, built on the official TypeScript SDK, with four
  read-only tools: `list_products`, `get_cycles`, `check_version` and
  `scan_project`.
- A bundled snapshot of endoflife.date data dated 28 October 2026: 487
  products and 9,250 release cycles, from upstream commit `794ba97`. It was
  cross-checked against the repository's front matter at that commit.
- Support status worked out for any date: supported, security fixes only or
  end of life. Answers include days remaining or overdue, the latest patch,
  the newest cycle, the recommended upgrade and a successor product
  (AngularJS → Angular, .NET Framework → .NET).
- `scan_project` detectors for these files:
  - Node.js and front end: `package.json`, `package-lock.json`,
    `angular.json`, `bower.json`, `.nvmrc`, `.node-version`;
  - .NET: `*.csproj` / `*.vbproj` / `*.fsproj`, `Directory.Build.props`,
    `global.json`, `web.config`, `packages.config`;
  - Python: `requirements*.txt`, `pyproject.toml`, `Pipfile`,
    `.python-version`, `runtime.txt`;
  - containers and tools: `Dockerfile`, `docker-compose*.yml`,
    `.tool-versions`.
- `scan_project` results are sorted by urgency and come with a summary
  paragraph in plain English.
- `refresh` command: endoflife.date API first, with a shallow Git clone of
  the upstream repository as the fallback. `info` command.
- Vitest suite (153 tests, fixed "today") and a deterministic 24-case
  evaluation set (`npm run eval`).
