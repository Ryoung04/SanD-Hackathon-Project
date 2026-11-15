import { SOURCES } from '../../src/lib/data/sourceRegistry';
import { normalizeProwagRamp, normalizeProwagAps, PROWAG_APS_URL } from '../../src/lib/data/normalizers';
import type { BarrierObservation, Bbox } from '../../src/lib/data/types';
import { getLayerMeta, queryAll } from './arcgis';

export async function ingestProwag(bbox: Bbox): Promise<{ fetched: number; obs: BarrierObservation[] }> {
  const url = SOURCES.prowag.endpoint;
  const meta = await getLayerMeta(url);
  const feats = await queryAll(url, { where: '1=1', bbox, maxRecordCount: meta.maxRecordCount });
  const obs = feats.map((f) => normalizeProwagRamp(f, meta.lastEditIso)).filter((o): o is BarrierObservation => !!o);
  // Layer 1 (Missing APS) shares source_kind city_gis, so it MUST be fetched in this same step:
  // run-all marks every city_gis id absent from this step's result as outdated.
  const apsMeta = await getLayerMeta(PROWAG_APS_URL);
  const apsFeats = await queryAll(PROWAG_APS_URL, { where: 'APS_DEFICIT > 0', bbox, maxRecordCount: apsMeta.maxRecordCount });
  const aps = apsFeats.map((f) => normalizeProwagAps(f, apsMeta.lastEditIso)).filter((o): o is BarrierObservation => !!o);
  return { fetched: feats.length + apsFeats.length, obs: [...obs, ...aps] };
}
