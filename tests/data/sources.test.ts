import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listSources } from '@/lib/data/sources';
import { validateBranchCounts } from '../../scripts/ingest/branch-ingest';

function obs(id: string, kind: string, status: string, lon = -117.16, lat = 32.72) {
  return { id, category: 'missing_curb_ramp', label: 'x', geometry: { type: 'Point', coordinates: [lon, lat] }, geometry_precision: 'intersection',
    source_kind: kind, source_record_id: id, source_url: 'u', source_observed_at: null, source_updated_at: '2026-01-02T00:00:00.000Z',
    ingested_at: '2026-01-03T00:00:00.000Z', verification_status: status, routing_impact: 'informational', severity: 'low', description: '', evidence: [], metadata: {} };
}

describe('listSources (file store)', () => {
  beforeEach(() => {
    delete process.env.DATABASE_URL;
    const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'src-')), 'o.json');
    fs.writeFileSync(p, JSON.stringify({ data_mode: 'live_import', updated_at: '', observations: [
      obs('a', 'city_gis', 'official_inventory'), obs('b', 'city_gis', 'outdated'), obs('c', 'city_311', 'unverified_report', -118, 33), obs('d', 'web_notice', 'unknown'),
    ] }));
    process.env.OBS_STORE_PATH = p;
  });
  it('counts current vs outdated, null last_run, extra kinds', async () => {
    const r = await listSources();
    const gis = r.data.find((s) => s.source_kind === 'city_gis')!;
    expect([gis.count_current, gis.count_outdated, gis.last_run]).toEqual([1, 1, null]);
    expect(gis.source_layer_updated_at).toBe('2026-01-02T00:00:00.000Z');
    expect(r.data.find((s) => s.source_kind === 'traffic_control')!.count_current).toBe(0);
    expect(r.data.some((s) => s.source_kind === 'web_notice')).toBe(true);
    expect(r.meta.history_available).toBe(false);
  });
  it('applies bbox', async () => {
    const r = await listSources({ bbox: [-117.2, 32.7, -117.1, 32.8] });
    expect(r.data.find((s) => s.source_kind === 'city_311')!.count_current).toBe(0);
  });
});

describe('validateBranchCounts', () => {
  const ok = { status: 'ok', normalized: 10 };
  const good = { runs: { city_gis: ok, traffic_control: ok, city_311: ok }, current: { city_gis: 10, traffic_control: 10, city_311: 10 } };
  it('passes healthy branch', () => expect(validateBranchCounts({ city_gis: 10, traffic_control: 10, city_311: 10 }, good).ok).toBe(true));
  it('fails on failed run, zero normalized and low count', () => {
    const v = validateBranchCounts({ city_gis: 100, traffic_control: 10, city_311: 0 }, {
      runs: { city_gis: ok, traffic_control: { status: 'failed', normalized: null }, city_311: { status: 'ok', normalized: 0 } },
      current: { city_gis: 40, traffic_control: 10, city_311: 5 } });
    expect(v.ok).toBe(false);
    expect(v.reasons).toHaveLength(3);
  });
  it('skips ratio when main is 0', () => expect(validateBranchCounts({}, good).ok).toBe(true));
});
