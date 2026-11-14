import { SOURCES } from '../../src/lib/data/sourceRegistry';
import { normalizeTrafficControl } from '../../src/lib/data/normalizers';
import type { BarrierObservation, Bbox } from '../../src/lib/data/types';
import { queryAll } from './arcgis';

export async function ingestTraffic(bbox: Bbox): Promise<{ fetched: number; obs: BarrierObservation[] }> {
  const today = new Date().toISOString().slice(0, 10);
  const feats = await queryAll(SOURCES.traffic.endpoint, { where: `DATE_END >= DATE '${today}'`, bbox });
  const obs = feats.map((f) => normalizeTrafficControl(f)).filter((o): o is BarrierObservation => !!o);
  return { fetched: feats.length, obs };
}
