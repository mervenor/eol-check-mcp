/**
 * The bundled snapshot format. It is a trimmed copy of endoflife.date data that
 * keeps the raw date-or-boolean value of each support phase, so that status can
 * be recomputed for any date rather than frozen at the moment of download.
 */

/** A support phase is either a date (ISO, YYYY-MM-DD) or a plain yes/no flag. */
export type PhaseValue = string | boolean;

export interface SnapshotRelease {
  /** Release cycle identifier, for example "8", "3.12", "4.8.1" or "3.5-sp1". */
  cycle: string;
  /** Display label without any LTS suffix, for example "Core 3.1". */
  label: string;
  codename?: string;
  releaseDate?: string;
  /** true/false, or the date the cycle becomes LTS. */
  lts?: PhaseValue;
  /** End of active support (only for products that track it). */
  eoas?: PhaseValue;
  /** End of life: end of security support (the main date). */
  eol?: PhaseValue;
  /** End of extended, usually commercial, support (only for products that track it). */
  eoes?: PhaseValue;
  /** Discontinued (mainly hardware products). */
  discontinued?: PhaseValue;
  latest?: string;
  latestDate?: string;
}

export interface PhaseLabels {
  eoas: string | null;
  eol: string | null;
  eoes: string | null;
  discontinued: string | null;
}

export interface SnapshotProduct {
  name: string;
  label: string;
  aliases: string[];
  category: string;
  labels: PhaseLabels;
  link: string;
  releasePolicy?: string;
  releases: SnapshotRelease[];
}

export interface SnapshotSource {
  /** Always "endoflife.date". */
  name: string;
  /** How the snapshot was built. */
  method: 'api-v1' | 'git-front-matter';
  /** API URL used, when method is api-v1. */
  apiUrl?: string;
  /** generated_at reported by the API, when method is api-v1. */
  apiGeneratedAt?: string;
  /** Upstream Git repository of the data. */
  repository: string;
  /** Commit of the upstream repository the data corresponds to, when known. */
  commit?: string;
  /** Commit date (ISO 8601), when known. */
  commitDate?: string;
  /** Licence of the data. */
  licence: string;
  licenceUrl: string;
}

export interface Snapshot {
  schemaVersion: 1;
  /** Calendar date (YYYY-MM-DD) the data was taken. */
  dataDate: string;
  /** Timestamp (ISO 8601) the snapshot file was written. */
  createdAt: string;
  source: SnapshotSource;
  productCount: number;
  products: SnapshotProduct[];
}
