import type { Bbox } from '../../src/lib/data/types';
import type { ArcGisFeature } from '../../src/lib/data/normalizers';

async function getJson(url: string, init?: RequestInit): Promise<any> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
  const j: any = await res.json();
  if (j && j.error) throw new Error(`ArcGIS error ${j.error.code}: ${j.error.message}`);
  return j;
}

export async function getLayerMeta(layerUrl: string): Promise<{ lastEditIso: string | null; maxRecordCount: number }> {
  const j = await getJson(`${layerUrl}?f=json`);
  const ms = j?.editingInfo?.lastEditDate;
  return {
    lastEditIso: typeof ms === 'number' ? new Date(ms).toISOString() : null,
    maxRecordCount: typeof j?.maxRecordCount === 'number' ? j.maxRecordCount : 1000,
  };
}

export async function queryAll(layerUrl: string, opts: { where: string; bbox: Bbox; maxRecordCount?: number }): Promise<ArcGisFeature[]> {
  const meta = opts.maxRecordCount ? { maxRecordCount: opts.maxRecordCount } : await getLayerMeta(layerUrl);
  const pageSize = Math.min(meta.maxRecordCount, 1000);
  const all: ArcGisFeature[] = [];
  for (let offset = 0; offset < 100000; offset += pageSize) {
    const params = new URLSearchParams({
      f: 'json', where: opts.where, outFields: '*', returnGeometry: 'true',
      geometry: opts.bbox.join(','), geometryType: 'esriGeometryEnvelope', inSR: '4326', outSR: '4326',
      spatialRel: 'esriSpatialRelIntersects', resultOffset: String(offset), resultRecordCount: String(pageSize),
      orderByFields: 'OBJECTID',
    });
    const j = await getJson(`${layerUrl}/query`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: params.toString() });
    const feats: ArcGisFeature[] = j.features ?? [];
    all.push(...feats);
    if (feats.length < pageSize && !j.exceededTransferLimit) break;
    if (feats.length === 0) break;
  }
  const nullGeom = all.filter((f) => !f.geometry || typeof f.geometry.x !== 'number').length;
  console.log(`  [arcgis] ${new URL(layerUrl).host}: fetched ${all.length}, null-geometry ${nullGeom}`);
  return all;
}
