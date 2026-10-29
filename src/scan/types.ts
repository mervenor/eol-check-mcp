/** Shared types for the project scanner. */

/**
 * How precise a detected version is:
 *  - exact: a pinned or installed version (lock file, Dockerfile tag, TargetFramework);
 *  - minimum: the lowest version a range allows (package.json "^1.5.0", engines ">=14");
 *  - floating: a tag that moves across release cycles ("mysql:8"); we use the newest match;
 *  - unknown: we know the product is used but not which version.
 */
export type Precision = 'exact' | 'minimum' | 'floating' | 'unknown';

export interface Detection {
  /** endoflife.date product id. */
  product: string;
  /** Version as found (after light clean-up), or "" when unknown. */
  version: string;
  precision: Precision;
  file: string;
  /** What we read, for example `TargetFramework net6.0` or `FROM node:14-alpine`. */
  evidence: string;
  /** Framework this detection also stands for, when it shares the product's lifecycle (ASP.NET Core). */
  component?: string;
  /** Groups manifest ranges with lock-file versions of the same dependency ("npm:react"). */
  dependencyKey?: string;
  /** True when the version comes from a lock file, i.e. what is actually installed. */
  locked?: boolean;
}

export interface FileInput {
  path: string;
  content: string;
}

export interface DetectorResult {
  /** What we recognised the file as, for example "package.json". */
  kind: string;
  detections: Detection[];
  notes: string[];
}

export type Detector = (file: FileInput) => DetectorResult;
