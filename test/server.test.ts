/** End-to-end over MCP: a real client talks to the server through an in-memory transport. */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from '../src/server.js';
import { fixtureSnapshot, TODAY } from './fixture-snapshot.js';

let client: Client;

beforeAll(async () => {
  const server = createServer(fixtureSnapshot, { today: () => TODAY });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'test', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
});

afterAll(async () => {
  await client.close();
});

type ToolResult = { content: { type: string; text: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean };
const call = async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args })) as ToolResult;

describe('MCP server', () => {
  it('exposes four read-only tools with input schemas and descriptions', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['check_version', 'get_cycles', 'list_products', 'scan_project']);
    for (const t of tools) {
      expect(t.description?.length ?? 0).toBeGreaterThan(40);
      expect(t.inputSchema.type).toBe('object');
      expect(t.annotations?.readOnlyHint).toBe(true);
    }
    const check = tools.find((t) => t.name === 'check_version');
    expect(check?.inputSchema.required).toEqual(['product', 'version']);
  });

  it('check_version returns text and structured content', async () => {
    const r = await call('check_version', { product: 'dotnet', version: '8' });
    expect(r.isError).toBeFalsy();
    expect(r.content[0]?.text).toContain('supported until 10 November 2026 (13 days left)');
    expect(r.structuredContent?.status).toBe('supported');
    expect(r.structuredContent?.dataDate).toBe(fixtureSnapshot.dataDate);
  });

  it('check_version honours the date argument and rejects bad dates', async () => {
    const later = await call('check_version', { product: 'dotnet', version: '8', date: '2026-11-11' });
    expect(later.structuredContent?.status).toBe('end-of-life');
    const bad = await call('check_version', { product: 'dotnet', version: '8', date: '11/11/2026' });
    expect(bad.isError).toBe(true);
  });

  it('check_version marks unknown products as errors with suggestions', async () => {
    const r = await call('check_version', { product: 'postgress', version: '12' });
    expect(r.isError).toBe(true);
    expect(r.content[0]?.text).toContain('Did you mean: postgresql');
  });

  it('get_cycles lists the release schedule', async () => {
    const r = await call('get_cycles', { product: 'nodejs', limit: 3 });
    expect((r.structuredContent?.cycles as unknown[]).length).toBe(3);
    expect(r.content[0]?.text).toContain('- 26:');
  });

  it('list_products searches the catalogue', async () => {
    const r = await call('list_products', { query: 'net' });
    expect(r.content[0]?.text).toContain('dotnetfx: Microsoft .NET Framework');
  });

  it('scan_project scans file contents', async () => {
    const r = await call('scan_project', {
      files: [
        { path: 'package.json', content: '{"dependencies":{"angular":"1.8.2"}}' },
        { path: 'App.csproj', content: '<Project><PropertyGroup><TargetFramework>net6.0</TargetFramework></PropertyGroup></Project>' },
      ],
    });
    const findings = r.structuredContent?.findings as { product: string; status: string }[];
    expect(findings.map((f) => `${f.product}:${f.status}`)).toEqual(['angularjs:end-of-life', 'dotnet:end-of-life']);
    expect(r.content[0]?.text).toMatch(/^On 28 October 2026 we found 2 components/);
  });
});
