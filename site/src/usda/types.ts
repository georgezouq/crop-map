export type Region = 'conus' | 'hawaii';
export interface Crop {
  code: number;
  name: string;
  rgb: number[];
  color: string;
}
export interface Year {
  year: number;
  rasterIds: number[];
  datasets: string[];
  coverage: string;
}
export interface Catalog {
  importedAt: string;
  source: string;
  sourceUrl: string;
  releaseUrl: string;
  regions: Record<Region, { service: string; years: Year[]; classes: Crop[] }>;
}
export interface HistoryRow {
  year: number;
  status: 'ok' | 'nodata' | 'error';
  code: number | null;
  name: string;
  resolution: number | null;
  fetchedAt?: string;
  cache?: string;
  coverage: string;
}
export interface History {
  region: Region;
  lon: number;
  lat: number;
  rows: HistoryRow[];
  source: string;
  catalogImportedAt: string;
}
