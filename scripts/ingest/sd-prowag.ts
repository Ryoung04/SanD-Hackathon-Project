import { SOURCES } from '../../src/lib/data/sourceRegistry';
import { normalizeProwagRamp } from '../../src/lib/data/normalizers';
import type { BarrierObservation, Bbox } from '../../src/lib/data/types';
import { getLayerMeta, queryAll } from './arcgis';

export async function ingestProwag(bbox: Bbox): Promise<{ fetched: number; obs: BarrierObservation[] }> {
  const url = SOURCES.prowag.endpoint;
  const meta = await getLayerMeta(url);
  const feats = await queryAll(url, { where: '1=1', bbox, maxRecordCount: meta.maxRecordCount });
  const obs = feats.map((f) => normalizeProwagRamp(f, meta.lastEditIso)).filter((o): o is BarrierObservation => !!o);
  return { fetched: feats.length, obs };
}
