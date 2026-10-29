import { describe, expect, it } from 'vitest';
import { detectImage, fromLines, parseImageRef, scanCompose, scanDockerfile } from '../src/scan/docker.js';
import { parseTfm, scanGlobalJson, scanMsbuild, scanPackagesConfig, scanWebConfig } from '../src/scan/dotnet.js';
import { scanNvmrc, scanToolVersions } from '../src/scan/misc.js';
import { scanAngularJson, scanBowerJson, scanPackageJson, scanPackageLock } from '../src/scan/npm.js';
import { parseRequirementLine, scanPipfile, scanPyproject, scanPythonVersionFile, scanRequirements } from '../src/scan/python.js';
import { npmMinimum, pythonMinimum } from '../src/scan/ranges.js';

const f = (path: string, content: string) => ({ path, content });
const pv = (r: { detections: { product: string; version: string; precision: string }[] }) =>
  r.detections.map((d) => `${d.product}@${d.version}:${d.precision}`);

describe('ranges', () => {
  it.each([
    ['^1.6.4', '1.6.4', 'minimum'],
    ['~1.6.4', '1.6.4', 'minimum'],
    ['>=14', '14.0.0', 'minimum'],
    ['14.x', '14.0.0', 'minimum'],
    ['1.5.8', '1.5.8', 'exact'],
    ['=2.2.4', '2.2.4', 'exact'],
    ['v18.19.0', '18.19.0', 'exact'],
    ['>=16.14 <21', '16.14.0', 'minimum'],
    ['npm:react@^18.2.0', '18.2.0', 'minimum'],
  ])('npmMinimum(%s)', (spec, version, precision) => {
    expect(npmMinimum(spec)).toEqual({ version, precision });
  });

  it.each(['*', 'latest', 'file:../lib', 'github:user/repo', 'workspace:*', 'https://example.com/x.tgz'])('npmMinimum(%s) is null', (spec) => {
    expect(npmMinimum(spec)).toBeNull();
  });

  it.each([
    ['==3.2.18', '3.2.18', 'exact'],
    ['>=3.2,<4.0', '3.2', 'minimum'],
    ['~=4.2.0', '4.2.0', 'minimum'],
    ['^3.9', '3.9', 'minimum'],
    ['>=3.8', '3.8', 'minimum'],
    ['==3.11.*', '3.11', 'minimum'],
  ])('pythonMinimum(%s)', (spec, version, precision) => {
    expect(pythonMinimum(spec)).toEqual({ version, precision });
  });

  it('pythonMinimum has no answer without a lower bound', () => {
    expect(pythonMinimum('<4')).toBeNull();
    expect(pythonMinimum('')).toBeNull();
  });
});

describe('package.json and friends', () => {
  it('reads dependencies, devDependencies and engines.node', () => {
    const r = scanPackageJson(
      f(
        'package.json',
        JSON.stringify({
          dependencies: { angular: '~1.6.4', react: '^18.2.0', next: '13.5.6', vue: '^2.6.14', lodash: '^4' },
          devDependencies: { '@angular/core': '~15.2.0' },
          engines: { node: '>=16.14' },
        }),
      ),
    );
    expect(pv(r)).toEqual([
      'angularjs@1.6.4:minimum',
      'react@18.2.0:minimum',
      'nextjs@13.5.6:exact',
      'vue@2.6.14:minimum',
      'angular@15.2.0:minimum',
      'nodejs@16.14.0:minimum',
    ]);
  });

  it('reports malformed JSON as a note instead of throwing', () => {
    const r = scanPackageJson(f('package.json', '{ "dependencies": '));
    expect(r.detections).toEqual([]);
    expect(r.notes[0]).toMatch(/could not parse JSON/);
  });

  it('accepts a byte order mark', () => {
    expect(pv(scanPackageJson(f('package.json', '﻿{"dependencies":{"react":"18.2.0"}}')))).toEqual(['react@18.2.0:exact']);
  });

  it('reads top-level packages from package-lock.json v3 and ignores nested copies', () => {
    const lock = {
      lockfileVersion: 3,
      packages: {
        '': { name: 'x' },
        'node_modules/react': { version: '18.2.0' },
        'node_modules/next': { version: '13.5.6' },
        'node_modules/some-lib/node_modules/react': { version: '16.14.0' },
        'node_modules/@angular/core': { version: '15.2.10' },
      },
    };
    expect(pv(scanPackageLock(f('package-lock.json', JSON.stringify(lock))))).toEqual([
      'react@18.2.0:exact',
      'nextjs@13.5.6:exact',
      'angular@15.2.10:exact',
    ]);
  });

  it('reads package-lock.json v1', () => {
    const lock = { lockfileVersion: 1, dependencies: { angular: { version: '1.8.2' } } };
    expect(pv(scanPackageLock(f('package-lock.json', JSON.stringify(lock))))).toEqual(['angularjs@1.8.2:exact']);
  });

  it('reads bower.json', () => {
    expect(pv(scanBowerJson(f('bower.json', JSON.stringify({ dependencies: { angular: '1.5.8', jquery: '~2.1.0' } }))))).toEqual([
      'angularjs@1.5.8:exact',
      'jquery@2.1.0:minimum',
    ]);
  });

  it('angular.json marks Angular as used with an unknown version', () => {
    expect(pv(scanAngularJson(f('angular.json', JSON.stringify({ projects: { app: {} } }))))).toEqual(['angular@:unknown']);
  });
});

describe('.NET files', () => {
  it.each([
    ['net8.0', 'dotnet', '8.0'],
    ['net10.0', 'dotnet', '10.0'],
    ['net9.0-android', 'dotnet', '9.0'],
    ['netcoreapp3.1', 'dotnet', '3.1'],
    ['net48', 'dotnetfx', '4.8'],
    ['net472', 'dotnetfx', '4.7.2'],
    ['net35', 'dotnetfx', '3.5'],
    ['v4.5.2', 'dotnetfx', '4.5.2'],
  ])('parseTfm(%s)', (tfm, product, version) => {
    expect(parseTfm(tfm)).toEqual({ product, version });
  });

  it('parseTfm ignores netstandard', () => {
    expect(parseTfm('netstandard2.0')).toBeNull();
  });

  it('flags web projects as ASP.NET Core', () => {
    const r = scanMsbuild(f('Web.csproj', '<Project Sdk="Microsoft.NET.Sdk.Web"><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>'), 'project file');
    expect(pv(r)).toEqual(['dotnet@8.0:exact']);
    expect(r.detections[0]?.component).toBe('ASP.NET Core');
  });

  it('reads multi-targeting and ignores commented-out frameworks', () => {
    const xml = `<Project Sdk="Microsoft.NET.Sdk">
      <!-- <TargetFramework>net5.0</TargetFramework> -->
      <PropertyGroup><TargetFrameworks>net9.0;net8.0;netstandard2.0</TargetFrameworks></PropertyGroup>
    </Project>`;
    const r = scanMsbuild(f('Lib.csproj', xml), 'project file');
    expect(pv(r)).toEqual(['dotnet@9.0:exact', 'dotnet@8.0:exact']);
    expect(r.detections[0]?.component).toBeUndefined();
  });

  it('reads old-style .NET Framework projects and marks ASP.NET MVC', () => {
    const xml = `<Project ToolsVersion="15.0"><PropertyGroup><TargetFrameworkVersion>v4.6.1</TargetFrameworkVersion></PropertyGroup>
      <ItemGroup><Reference Include="System.Web.Mvc, Version=5.2.3.0" /></ItemGroup></Project>`;
    const r = scanMsbuild(f('Old.csproj', xml), 'project file');
    expect(pv(r)).toEqual(['dotnetfx@4.6.1:exact']);
    expect(r.detections[0]?.component).toBe('ASP.NET (MVC / Web API)');
  });

  it('notes MSBuild properties it cannot resolve', () => {
    const r = scanMsbuild(f('A.csproj', '<Project><PropertyGroup><TargetFramework>$(AppTfm)</TargetFramework></PropertyGroup></Project>'), 'project file');
    expect(r.detections).toEqual([]);
    expect(r.notes[0]).toMatch(/Directory.Build.props/);
  });

  it('reads Directory.Build.props', () => {
    const r = scanMsbuild(f('Directory.Build.props', '<Project><PropertyGroup><TargetFramework>net6.0</TargetFramework></PropertyGroup></Project>'), 'Directory.Build.props');
    expect(pv(r)).toEqual(['dotnet@6.0:exact']);
  });

  it('reads the SDK pin from global.json', () => {
    expect(pv(scanGlobalJson(f('global.json', '{"sdk":{"version":"8.0.404","rollForward":"latestFeature"}}')))).toEqual(['dotnet@8.0:exact']);
  });

  it('reads web.config and packages.config', () => {
    expect(pv(scanWebConfig(f('web.config', '<configuration><system.web><httpRuntime targetFramework="4.7.2" /></system.web></configuration>')))).toEqual([
      'dotnetfx@4.7.2:exact',
    ]);
    expect(pv(scanPackagesConfig(f('packages.config', '<packages><package id="X" version="1" targetFramework="net48" /></packages>')))).toEqual([
      'dotnetfx@4.8:exact',
    ]);
  });
});

describe('Python files', () => {
  it('parses requirement lines with extras, markers and comments', () => {
    expect(parseRequirementLine('django[argon2]>=4.2,<5 ; python_version > "3.8"  # web')).toEqual({ name: 'django', spec: '>=4.2,<5' });
    expect(parseRequirementLine('-r base.txt')).toBeNull();
    expect(parseRequirementLine('# comment')).toBeNull();
  });

  it('reads Django from requirements.txt', () => {
    expect(pv(scanRequirements(f('requirements.txt', 'Django==3.2.18\ngunicorn==20.1.0\n')))).toEqual(['django@3.2.18:exact']);
  });

  it('reads requires-python and dependencies from pyproject.toml (PEP 621)', () => {
    const toml = '[project]\nname = "x"\nrequires-python = ">=3.9"\ndependencies = ["Django>=4.2,<5.0", "requests"]\n';
    expect(pv(scanPyproject(f('pyproject.toml', toml)))).toEqual(['python@3.9:minimum', 'django@4.2:minimum']);
  });

  it('reads Poetry dependencies from pyproject.toml', () => {
    const toml = '[tool.poetry.dependencies]\npython = "^3.10"\ndjango = { version = "^5.0", extras = ["argon2"] }\n';
    expect(pv(scanPyproject(f('pyproject.toml', toml)))).toEqual(['python@3.10:minimum', 'django@5.0:minimum']);
  });

  it('reports invalid TOML as a note', () => {
    expect(scanPyproject(f('pyproject.toml', '[project\nname=')).notes[0]).toMatch(/could not parse TOML/);
  });

  it('reads .python-version, runtime.txt and Pipfile', () => {
    expect(pv(scanPythonVersionFile(f('.python-version', '3.11.7\n'), '.python-version'))).toEqual(['python@3.11.7:exact']);
    expect(pv(scanPythonVersionFile(f('runtime.txt', 'python-3.9.18'), 'runtime.txt'))).toEqual(['python@3.9.18:exact']);
    expect(pv(scanPipfile(f('Pipfile', '[packages]\ndjango = "==2.2"\n\n[requires]\npython_version = "3.7"\n')))).toEqual([
      'python@3.7:exact',
      'django@2.2:exact',
    ]);
  });
});

describe('Node version files', () => {
  it.each([
    ['v18.19.0', 'nodejs@18.19.0:exact'],
    ['20', 'nodejs@20:exact'],
    ['lts/iron', 'nodejs@lts/iron:exact'],
  ])('.nvmrc %s', (content, expected) => {
    expect(pv(scanNvmrc(f('.nvmrc', `${content}\n`), '.nvmrc'))).toEqual([expected]);
  });

  it('.nvmrc "node" or "lts/*" has no fixed version', () => {
    expect(scanNvmrc(f('.nvmrc', 'lts/*'), '.nvmrc').detections).toEqual([]);
  });

  it('reads .tool-versions', () => {
    expect(pv(scanToolVersions(f('.tool-versions', 'nodejs 18.19.0\npython 3.11.7\nterraform 1.6.0\n')))).toEqual([
      'nodejs@18.19.0:exact',
      'python@3.11.7:exact',
    ]);
  });
});

describe('Dockerfile and compose', () => {
  it('splits image references', () => {
    expect(parseImageRef('docker.io/library/node:18-alpine@sha256:abc')).toEqual({ image: 'docker.io/library/node', tag: '18-alpine', digest: 'sha256:abc' });
    expect(parseImageRef('localhost:5000/app')).toEqual({ image: 'localhost:5000/app', tag: '', digest: undefined });
  });

  it('skips build-stage references, scratch and honours ARG defaults and line continuations', () => {
    const df = [
      'ARG NODE_VERSION=16',
      'FROM --platform=$BUILDPLATFORM node:${NODE_VERSION}-alpine AS build',
      'RUN npm ci',
      'FROM build AS test',
      'FROM \\',
      '  nginx:1.25.3-alpine',
      'FROM scratch',
    ].join('\n');
    expect(fromLines(df).map((x) => x.ref)).toEqual(['node:16-alpine', 'nginx:1.25.3-alpine']);
  });

  it('maps official and Microsoft images to products', () => {
    expect(detectImage('node:12-alpine', 'Dockerfile', 'x').detection).toMatchObject({ product: 'nodejs', version: '12', precision: 'floating' });
    expect(detectImage('python:3.8-slim-bullseye', 'Dockerfile', 'x').detection).toMatchObject({ product: 'python', version: '3.8' });
    expect(detectImage('postgres:12.4', 'Dockerfile', 'x').detection).toMatchObject({ product: 'postgresql', version: '12.4', precision: 'exact' });
    expect(detectImage('bitnami/postgresql:14', 'Dockerfile', 'x').detection).toMatchObject({ product: 'postgresql', version: '14' });
    expect(detectImage('mysql:8', 'Dockerfile', 'x').detection).toMatchObject({ product: 'mysql', version: '8', precision: 'floating' });
    expect(detectImage('mcr.microsoft.com/dotnet/aspnet:6.0', 'Dockerfile', 'x').detection).toMatchObject({
      product: 'dotnet',
      version: '6.0',
      component: 'ASP.NET Core',
    });
    expect(detectImage('mcr.microsoft.com/dotnet/framework/aspnet:4.8-windowsservercore-ltsc2019', 'Dockerfile', 'x').detection).toMatchObject({
      product: 'dotnetfx',
      version: '4.8',
    });
    expect(detectImage('node:hydrogen', 'Dockerfile', 'x').detection).toMatchObject({ product: 'nodejs', version: 'hydrogen' });
  });

  it('notes unpinned and unknown tags instead of guessing', () => {
    expect(detectImage('redis:latest', 'compose.yml', 'image: redis:latest').note).toMatch(/no pinned version/);
    expect(detectImage('node:lts-alpine', 'Dockerfile', 'FROM node:lts-alpine').note).toMatch(/moving "lts" tag/);
    expect(detectImage('mycompany/api:1.2.3', 'Dockerfile', 'x')).toEqual({});
  });

  it('scans a Dockerfile and a compose file', () => {
    expect(pv(scanDockerfile(f('Dockerfile', 'FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build\nFROM mcr.microsoft.com/dotnet/aspnet:8.0')))).toEqual([
      'dotnet@8.0:exact',
      'dotnet@8.0:exact',
    ]);
    expect(pv(scanCompose(f('docker-compose.yml', 'services:\n  db:\n    image: "postgres:11.22"\n  web:\n    build: .\n')))).toEqual([
      'postgresql@11.22:exact',
    ]);
  });
});
