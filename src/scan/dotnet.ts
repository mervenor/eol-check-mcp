/** *.csproj (and *.vbproj, *.fsproj), Directory.Build.props, global.json, web.config, packages.config. */
import type { Detection, DetectorResult, FileInput } from './types.js';

/** Turns a target framework moniker into an endoflife.date product and version. */
export function parseTfm(tfm: string): { product: 'dotnet' | 'dotnetfx'; version: string } | null {
  const t = tfm.trim().toLowerCase();
  // .NET 5+ : net5.0, net8.0, net8.0-windows, net9.0-android
  let m = /^net(\d{1,2})\.(\d+)(?:-[a-z0-9.]+)?$/.exec(t);
  if (m?.[1] && Number(m[1]) >= 5) return { product: 'dotnet', version: `${m[1]}.${m[2]}` };
  // .NET Core : netcoreapp2.1, netcoreapp3.1
  m = /^netcoreapp(\d+\.\d+)$/.exec(t);
  if (m?.[1]) return { product: 'dotnet', version: m[1] };
  // .NET Framework : net48, net472, net461, net35, net20
  m = /^net(\d)(\d)(\d)?$/.exec(t);
  if (m?.[1] && m[2]) return { product: 'dotnetfx', version: [m[1], m[2], m[3]].filter(Boolean).join('.') };
  // Old-style project: v4.7.2
  m = /^v(\d+\.\d+(?:\.\d+)?)$/.exec(t);
  if (m?.[1]) return { product: 'dotnetfx', version: m[1] };
  return null;
}

function tagValues(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([^<]*)</${tag}>`, 'gi');
  return [...xml.matchAll(re)].map((m) => (m[1] ?? '').trim()).filter(Boolean);
}

function stripXmlComments(xml: string): string {
  return xml.replace(/<!--[\s\S]*?-->/g, '');
}

/** Shared by project files and Directory.Build.props. */
export function scanMsbuild(file: FileInput, kind: string): DetectorResult {
  const xml = stripXmlComments(file.content);
  const detections: Detection[] = [];
  const notes: string[] = [];

  const sdkMatch = /<Project\b[^>]*\bSdk\s*=\s*"([^"]+)"/i.exec(xml);
  const sdk = sdkMatch?.[1] ?? '';
  const isWeb = /Microsoft\.NET\.Sdk\.(Web|Razor|BlazorWebAssembly)/i.test(sdk) || /<FrameworkReference\s+Include="Microsoft\.AspNetCore\.App"/i.test(xml);

  const tfms: string[] = [];
  for (const v of tagValues(xml, 'TargetFramework')) tfms.push(v);
  for (const v of tagValues(xml, 'TargetFrameworks')) tfms.push(...v.split(';').map((s) => s.trim()).filter(Boolean));
  for (const v of tagValues(xml, 'TargetFrameworkVersion')) tfms.push(v);

  const seen = new Set<string>();
  for (const tfm of tfms) {
    if (tfm.includes('$(')) {
      notes.push(`${file.path}: target framework "${tfm}" uses an MSBuild property we cannot resolve; supply Directory.Build.props too.`);
      continue;
    }
    const parsed = parseTfm(tfm);
    if (!parsed) {
      if (!/^netstandard/i.test(tfm)) notes.push(`${file.path}: unrecognised target framework "${tfm}".`);
      continue;
    }
    const key = `${parsed.product}@${parsed.version}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const isAspNetCore = parsed.product === 'dotnet' && isWeb;
    detections.push({
      product: parsed.product,
      version: parsed.version,
      precision: 'exact',
      file: file.path,
      evidence: `${/^v\d/.test(tfm) ? 'TargetFrameworkVersion' : 'TargetFramework'} ${tfm}${isAspNetCore ? ` (${sdk || 'Microsoft.AspNetCore.App'})` : ''}`,
      component: isAspNetCore ? 'ASP.NET Core' : undefined,
    });
  }

  if (tfms.length === 0 && kind === 'project file') {
    notes.push(`${file.path}: no target framework in the file; it is probably set in Directory.Build.props, so supply that too.`);
  }

  // Classic ASP.NET MVC / Web API on .NET Framework: report as a component of .NET Framework.
  if (detections.some((d) => d.product === 'dotnetfx') && /System\.Web\.(Mvc|Http)|Microsoft\.AspNet\./i.test(xml)) {
    for (const d of detections) if (d.product === 'dotnetfx') d.component = 'ASP.NET (MVC / Web API)';
  }

  return { kind, detections, notes };
}

export function scanGlobalJson(file: FileInput): DetectorResult {
  try {
    const json = JSON.parse(file.content.replace(/^\uFEFF/, '')) as { sdk?: { version?: unknown } };
    const v = json.sdk?.version;
    if (typeof v !== 'string') return { kind: 'global.json', detections: [], notes: [`${file.path}: no sdk.version.`] };
    const m = /^(\d+)\.(\d+)\./.exec(v);
    if (!m) return { kind: 'global.json', detections: [], notes: [`${file.path}: unrecognised SDK version "${v}".`] };
    return {
      kind: 'global.json',
      detections: [
        {
          product: 'dotnet',
          version: `${m[1]}.${m[2]}`,
          precision: 'exact',
          file: file.path,
          evidence: `sdk.version ${v} (SDK pin)`,
        },
      ],
      notes: [],
    };
  } catch (err) {
    return { kind: 'global.json', detections: [], notes: [`${file.path}: could not parse JSON (${(err as Error).message}).`] };
  }
}

/** web.config: <httpRuntime targetFramework="4.7.2" /> or <compilation targetFramework="4.8" />. */
export function scanWebConfig(file: FileInput): DetectorResult {
  const xml = stripXmlComments(file.content);
  const m = /<(httpRuntime|compilation)\b[^>]*\btargetFramework\s*=\s*"([\d.]+)"/i.exec(xml);
  if (!m?.[2]) return { kind: 'web.config', detections: [], notes: [] };
  return {
    kind: 'web.config',
    detections: [
      {
        product: 'dotnetfx',
        version: m[2],
        precision: 'exact',
        file: file.path,
        evidence: `<${m[1]} targetFramework="${m[2]}">`,
        component: 'ASP.NET (System.Web)',
      },
    ],
    notes: [],
  };
}

/** packages.config: <package id="..." targetFramework="net472" /> */
export function scanPackagesConfig(file: FileInput): DetectorResult {
  const xml = stripXmlComments(file.content);
  const m = /\btargetFramework\s*=\s*"(net\d{2,3})"/i.exec(xml);
  const parsed = m?.[1] ? parseTfm(m[1]) : null;
  if (!parsed) return { kind: 'packages.config', detections: [], notes: [] };
  return {
    kind: 'packages.config',
    detections: [
      {
        product: parsed.product,
        version: parsed.version,
        precision: 'exact',
        file: file.path,
        evidence: `targetFramework="${m?.[1]}" in packages.config`,
      },
    ],
    notes: [],
  };
}
