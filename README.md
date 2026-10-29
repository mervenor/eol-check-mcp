# eol-check-mcp

An MCP (Model Context Protocol) server that lets an AI assistant answer one question well:
**is this project's stack still supported, and what should we upgrade first?**

Give your assistant (Claude Desktop, Claude Code or any MCP client) a project's `package.json`,
`.csproj`, `requirements.txt`, `Dockerfile` and similar files. It gets back every runtime and
framework we can detect, each one's support status and end dates, a list sorted by urgency, and
a one-paragraph summary in plain English.

- Works offline: a dated snapshot of [endoflife.date](https://endoflife.date) data ships with the
  server (487 products, 9,250 release cycles, data of 28 October 2026).
- Answers for any date, not only today: "will .NET 8 still be supported on 11 November 2026?"
- Read-only. It never touches your disk; the assistant passes file contents in.
- Optional `refresh` command downloads newer data when you are online.

## 30-second example

> **You:** Here are our `Web.csproj`, `package.json`, `Dockerfile` and `docker-compose.yml`. Is
> anything out of support?
>
> **Assistant** (calls `scan_project`): On 28 October 2026 we found 4 components with a published
> support schedule in 4 files. 3 are past end of life: AngularJS 1.8 (ended 31 December 2021),
> PostgreSQL 12 (ended 21 November 2024) and Node.js 18 (ended 30 April 2025). 1 loses support
> within 90 days: ASP.NET Core on Microsoft .NET 8 on 10 November 2026. Upgrade AngularJS 1.8
> first: it has had no security fixes for 1,762 days; the target is Angular 22.
>
> 1. [critical] AngularJS 1.8 (LTS): end-of-life (support ends 2021-12-31)
> 2. [critical] PostgreSQL 12: end-of-life (support ends 2024-11-21)
> 3. [critical] Node.js 18 (LTS): end-of-life (support ends 2025-04-30)
> 4. [high] ASP.NET Core on Microsoft .NET 8 (LTS): supported (support ends 2026-11-10)

That is real output from the bundled data, with the date fixed to 28 October 2026.

## Install

You need Node.js 20 or later. The package is not on npm yet, so build it from source:

```sh
git clone https://github.com/mervenor/eol-check-mcp.git
cd eol-check-mcp
npm install        # also builds dist/
node dist/index.js info
```

`info` prints the snapshot in use. In the configurations below, replace
`/absolute/path/to/eol-check-mcp` with the folder you cloned into.

### Claude Desktop

Open **Settings → Developer → Edit Config** and add the server to `claude_desktop_config.json`
(on macOS `~/Library/Application Support/Claude/claude_desktop_config.json`, on Windows
`%APPDATA%\Claude\claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "eol-check": {
      "command": "node",
      "args": ["/absolute/path/to/eol-check-mcp/dist/index.js"]
    }
  }
}
```

On Windows, write the path with escaped backslashes, for example
`"C:\\tools\\eol-check-mcp\\dist\\index.js"`. Restart Claude Desktop afterwards.

### Claude Code

```sh
claude mcp add eol-check -- node /absolute/path/to/eol-check-mcp/dist/index.js
claude mcp get eol-check
```

To share it with your team, add `--scope project`, or commit this `.mcp.json` at the project
root:

```json
{
  "mcpServers": {
    "eol-check": {
      "command": "node",
      "args": ["/absolute/path/to/eol-check-mcp/dist/index.js"]
    }
  }
}
```

### Other MCP clients

Run `node /absolute/path/to/eol-check-mcp/dist/index.js` as a stdio server.

## Tools

All four tools are read-only. Each returns a short text answer and the full result as structured
JSON (`structuredContent`). Wherever a tool takes `date` (YYYY-MM-DD), it defaults to today.

### `list_products(query?, category?, limit?)`

Finds product ids in the snapshot.

```json
{ "query": "angular" }
```

```text
2 products matching "angular":
- angular: Angular (framework)
- angularjs: AngularJS (framework)
```

### `get_cycles(product, date?, limit?)`

Lists a product's release cycles, newest first, with release date, LTS flag, end of active
support, end of security support, status, days remaining or overdue, and latest patch.

```json
{ "product": "dotnet", "limit": 4 }
```

```text
Microsoft .NET: 13 cycles tracked, 3 still supported on 28 October 2026. Recommended: Microsoft .NET 10 (LTS).

- 10 (LTS): supported, support ends 2028-11-14, latest 10.0.13
- 9: supported, support ends 2026-11-10, latest 9.0.21
- 8 (LTS): supported, support ends 2026-11-10, latest 8.0.32
- 7: end-of-life, support ends 2024-05-14, latest 7.0.20
```

### `check_version(product, version, date?)`

Checks one version. It returns:

- the status: `supported`, `security-only`, `end-of-life` or `unknown`;
- the dates, plus days remaining or days overdue;
- the latest patch in the cycle, the newest cycle and the recommended upgrade;
- a successor product where one exists (AngularJS → Angular, .NET Framework → .NET).

Versions are accepted the way people write them: `8`, `8.0.11`, `net8.0`, `net472`, `v4.6.2`,
`v18.19.0`, `lts/hydrogen`, `3.12`, `jammy`.

```json
{ "product": "angularjs", "version": "1.8.2" }
```

```text
AngularJS 1.8 (LTS) reached end of life on 31 December 2021 (1,762 days ago). Extended Long Term
Support is still available. AngularJS (1.x) was replaced by Angular (2 and later), which is a
rewrite rather than an upgrade. Current target: Angular 22.
```

```json
{ "product": "dotnet", "version": "net8.0", "date": "2026-11-11" }
```

```text
Microsoft .NET 8 (LTS) reached end of life on 10 November 2026 (1 day ago). Recommended upgrade:
Microsoft .NET 10 (LTS), supported until 14 November 2028.
```

### `scan_project(files, date?)`

Takes file contents and returns each detected runtime or framework with its status, sorted by
urgency (`critical` = end of life, `high` = ends within 90 days, `medium` = security fixes only
or ends within a year, `low`), the evidence (which file and line), caveats and a one-paragraph
summary.

```json
{
  "files": [
    { "path": "Web.csproj", "content": "<Project Sdk=\"Microsoft.NET.Sdk.Web\">…<TargetFramework>net8.0</TargetFramework>…" },
    { "path": "package.json", "content": "{ \"dependencies\": { \"angular\": \"~1.8.2\" }, \"engines\": { \"node\": \">=18\" } }" },
    { "path": "Dockerfile", "content": "FROM node:18-alpine AS assets\nFROM mcr.microsoft.com/dotnet/aspnet:8.0" },
    { "path": "docker-compose.yml", "content": "services:\n  db:\n    image: postgres:12" }
  ]
}
```

The answer is the one shown in the [30-second example](#30-second-example).

**Files we read**

| Ecosystem | Files |
| --- | --- |
| Node.js and front end | `package.json`, `package-lock.json` / `npm-shrinkwrap.json`, `angular.json`, `bower.json`, `.nvmrc`, `.node-version` |
| .NET | `*.csproj` / `*.vbproj` / `*.fsproj`, `Directory.Build.props`, `global.json`, `web.config`, `packages.config` |
| Python | `requirements*.txt`, `pyproject.toml` (PEP 621 and Poetry), `Pipfile`, `.python-version`, `runtime.txt` |
| Containers | `Dockerfile` (`FROM` lines, build stages, `ARG` defaults), `docker-compose*.yml` / `compose*.yaml` (`image:` lines) |
| Other | `.tool-versions` |

**What we detect:** Node.js; .NET (including .NET Core) and .NET Framework (3.5 SP1 to 4.8.1);
ASP.NET Core (shares the .NET lifecycle) and classic ASP.NET MVC / Web API (follows .NET
Framework); AngularJS; Angular; React; Next.js; Vue; Nuxt; Svelte; Ember; Express; Electron;
jQuery; Bootstrap; Python; Django; and, from image tags, PostgreSQL, MySQL, MariaDB, Redis,
MongoDB, nginx, PHP, Ruby, Go and base images (Debian, Ubuntu, Alpine).

## Data

- **Source:** [endoflife.date](https://endoflife.date), API v1 (`/api/v1/products/full`),
  downloaded on 28 October 2026.
- **Upstream commit:** `794ba970f0e122feb390dc7e58b44522ed8b1754` of
  [endoflife-date/endoflife.date](https://github.com/endoflife-date/endoflife.date). We rebuilt
  the snapshot from that commit's `products/*.md` front matter as a cross-check. Both sources
  agree on all 487 products and every support date across the 9,250 cycles.
- **Licence:** MIT, © endoflife.date contributors. See [NOTICE](NOTICE).
- **Checked facts:** the bundled data shows .NET 8 and .NET 9 end of support on
  10 November 2026, and AngularJS (every 1.x cycle) end of life on 31 December 2021. The test
  suite fails if a refresh changes either fact.

We store each date, not a yes/no flag, so status is worked out for whatever day you ask about.
A support end date is the last supported day; .NET 8 counts as end of life from 11 November 2026.

### Refreshing the data

```sh
node dist/index.js refresh                # API first, Git repository if the API is unreachable
node dist/index.js refresh --source git   # Git only (needs git on the PATH)
node dist/index.js info                   # which snapshot is in use
```

`refresh` writes to your user cache (`~/.cache/eol-check-mcp/snapshot.json`, or
`$XDG_CACHE_HOME`). The server uses that copy when it is at least as new as the bundled one.
Set `EOL_CHECK_SNAPSHOT` to use a specific file. Set `EOL_CHECK_TODAY=YYYY-MM-DD` to fix
"today" for demos and tests.

## Limits

- **The data has a date.** Without `refresh`, answers reflect endoflife.date on 28 October 2026.
  Vendors move dates and new releases appear.
- **Some products publish no end date.** React and .NET Framework 4.8 / 4.8.1 are examples. We
  report these as supported or security-only with "no end date published"; we do not guess one.
- **Ranges are read at their lowest version.** `"react": "^18.2.0"` is checked as 18.2.0; add the
  lock file for the installed version. We read `package-lock.json`, but not `yarn.lock` or
  `pnpm-lock.yaml` yet.
- **Floating image tags** such as `mysql:8` are taken as the newest matching cycle (8.4) and
  flagged as floating. `latest` and `lts` tags are reported as notes, not guessed.
- **What we do not resolve:** MSBuild properties beyond what `Directory.Build.props` sets
  directly, and transitive dependencies.
- **What we do not do:** check vulnerabilities (CVEs), and we cannot see paid extended support
  you may have bought. When endoflife.date tracks extended support, we mention it, but we still
  count the version as end of life.
- **Unlisted products are ignored.** A framework that endoflife.date does not track is not
  reported.

## Development

```sh
npm install
npm test            # Vitest unit and end-to-end tests (fixed "today")
npm run eval        # 24-case evaluation set, deterministic, prints a score
npm run lint        # ESLint
npm run typecheck   # TypeScript, strict
npm run build       # compiles to dist/
npm run check       # all of the above
npm run snapshot    # maintainers: rebuild data/snapshot.json
```

`eval/cases.json` holds the questions, the tool an assistant should call and the facts the
answer must contain. `eval/run.ts` runs them through a real MCP client against the bundled data,
with no language model involved.

## Who maintains this

We are Mervenor. We take over, stabilise and modernise existing web applications, and add AI
features to them.

Need help upgrading what it finds? Mervenor — hello@mervenor.com — https://mervenor.com

## Licence

Code: MIT, see [LICENSE](LICENSE). Data: MIT, from endoflife.date, see [NOTICE](NOTICE).
