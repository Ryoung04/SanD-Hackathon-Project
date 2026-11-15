import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizeProwagRamp, normalizeTrafficControl, normalize311Row, sanitizeText, validateObservation, pacificToUtcIso } from '@/lib/data/normalizers';
import { parseBbox, intersectsBbox, distanceToLine, haversineMeters } from '@/lib/data/geo';
import { listObservations, upsertObservations, findNearRoute, markOutdated } from '@/lib/data/observations';
import type { BarrierObservation } from '@/lib/data/types';

// NOTE: all fixtures below are TEST FIXTURES copying record shapes from docs/source-audit.md; never served as data.
const prowagFeat = {
  attributes: { OBJECTID: 2960, NODE_ID: 43194, APPROACH_COUNT: 3, RAMPS_REQUIRED: 3, RAMPS_EXISTING: 2, RAMP_DEFICIT: 1, APS_DEFICIT: 0, cpname: 'Downtown' },
  geometry: { x: -117.170735, y: 32.729338 },
};
const row311 = {
  service_request_id: 'T-1', date_requested: '2026-07-01 08:30:00.000', service_name: 'Sidewalk Repair Issue',
  service_name_detail: 'SIDEWALK LIFTED', date_closed: '2026-08-01 00:00:00.000', status: 'Closed', lat: '32.72', lng: '-117.16',
  street_address: '123 PRIVATE ST', comm_plan_name: 'Downtown', public_description: 'Lifted <b>slab</b>\u0007 here',
};

let tmp: string;
beforeEach(() => {
  tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'obs-')), 'obs.json');
  process.env.OBS_STORE_PATH = tmp;
  delete process.env.DATABASE_URL;
});

function mk(over: Partial<BarrierObservation> = {}): BarrierObservation {
  return { ...normalizeProwagRamp(prowagFeat, null)!, ...over };
}

describe('bbox parsing', () => {
  it('rejects invalid bboxes', () => {
    for (const b of [null, '1,2,3', 'a,b,c,d', '-117,33,-118,34', '-117,32,-116,32', '-200,0,0,1', '-117.2,32.7,-116.5,32.8']) expect(parseBbox(b).ok).toBe(false);
    expect(parseBbox('-117.175,32.712,-117.15,32.73').ok).toBe(true);
  });
});

describe('store', () => {
  const bbox: [number, number, number, number] = [-117.175, 32.712, -117.15, 32.73];
  it('empty store returns []', async () => {
    const r = await listObservations({ bbox });
    expect(r.data).toEqual([]);
  });
  it('duplicate upsert updates, not duplicates', async () => {
    const a = await upsertObservations([mk()]);
    const b = await upsertObservations([mk({ label: 'changed' })]);
    expect([a.inserted, a.updated, b.inserted, b.updated]).toEqual([1, 0, 0, 1]);
    const r = await listObservations({ bbox });
    expect(r.data).toHaveLength(1);
    expect(r.data[0].label).toBe('changed');
  });
  it('matches a LineString crossing bbox with no vertex inside', async () => {
    const line = { type: 'LineString' as const, coordinates: [[-117.2, 32.72], [-117.1, 32.72]] as [number, number][] };
    expect(intersectsBbox(line, bbox)).toBe(true);
    await upsertObservations([mk({ id: 'x:line', source_record_id: 'line', geometry: line })]);
    const r = await listObservations({ bbox });
    expect(r.data.map((o) => o.id)).toContain('x:line');
    expect(intersectsBbox({ type: 'Point', coordinates: [-117.2, 32.72] }, bbox)).toBe(false);
  });
  it('records missing from the latest import are marked outdated and hidden', async () => {
    await upsertObservations([mk(), mk({ id: 'city_gis:prowag2:9999', source_record_id: '9999' })]);
    expect(await markOutdated('city_gis', [])).toBe(0); // empty fetch never expires a source
    expect(await markOutdated('city_gis', ['city_gis:prowag2:2960'])).toBe(1);
    const r = await listObservations({ bbox });
    expect(r.data.map((o) => o.id)).toEqual(['city_gis:prowag2:2960']);
    await expect(markOutdated('street_imagery_ai', ['x'])).rejects.toThrow();
  });
  it('traffic permits past date_end are hidden; active ones shown', async () => {
    const base = mk({ source_kind: 'traffic_control', category: 'construction_warning', verification_status: 'official_inventory' });
    await upsertObservations([
      { ...base, id: 'traffic_control:1', source_record_id: '1', metadata: { date_end: '2020-01-01T00:00:00.000Z' } },
      { ...base, id: 'traffic_control:2', source_record_id: '2', metadata: { date_end: '2099-01-01T00:00:00.000Z' } },
    ]);
    const r = await listObservations({ bbox });
    expect(r.data.map((o) => o.id)).toEqual(['traffic_control:2']);
  });
  it('pages list official records before 311 and paging covers every record once', async () => {
    const r311 = Array.from({ length: 3 }, (_, i) => mk({ id: `city_311:${i}`, source_record_id: String(i), source_kind: 'city_311', verification_status: 'unverified_report', routing_impact: 'possible_obstacle' }));
    const tc = mk({ id: 'traffic_control:7', source_record_id: '7', source_kind: 'traffic_control', category: 'construction_warning' });
    await upsertObservations([...r311, mk(), tc]);
    const p1 = await listObservations({ bbox, limit: 2 });
    expect(p1.data.map((o) => o.source_kind)).toEqual(['city_gis', 'traffic_control']);
    const seen = [...p1.data.map((o) => o.id)];
    let cursor = p1.next_cursor;
    while (cursor) { const p = await listObservations({ bbox, limit: 2, cursor }); seen.push(...p.data.map((o) => o.id)); cursor = p.next_cursor; }
    expect(seen).toEqual(['city_gis:prowag2:2960', 'traffic_control:7', 'city_311:0', 'city_311:1', 'city_311:2']);
  });
  it('near-route finds close points only', async () => {
    await upsertObservations([mk()]);
    const near = await findNearRoute({ type: 'LineString', coordinates: [[-117.1708, 32.7285], [-117.1708, 32.7295]] }, 30);
    expect(near).toHaveLength(1);
    expect(near[0].match_method).toBe('within_30m_approximate');
    const far = await findNearRoute({ type: 'LineString', coordinates: [[-117.16, 32.715], [-117.16, 32.716]] }, 30);
    expect(far).toHaveLength(0);
  });
});

describe('normalizers', () => {
  it('prowag has null observed date and intersection precision', () => {
    const o = normalizeProwagRamp(prowagFeat, '2026-06-24T01:02:00.000Z')!;
    expect(o.id).toBe('city_gis:prowag2:2960');
    expect(o.source_observed_at).toBeNull();
    expect(o.geometry_precision).toBe('intersection');
    expect(validateObservation(o).ok).toBe(true);
    expect(normalizeProwagRamp({ ...prowagFeat, attributes: { ...prowagFeat.attributes, RAMP_DEFICIT: 0 } }, null)).toBeNull();
  });
  it('traffic control keeps non-closure label', () => {
    const o = normalizeTrafficControl({ attributes: { OBJECTID: 5, APPROVAL_ID: 'PMT-1', DATE_END: 1800000000000, DATE_LAST_UPDATED: 1700000000000, BLOCK_INFORMATION: '<i>Main</i> St' }, geometry: { x: -117.16, y: 32.72 } })!;
    expect(o.source_observed_at).toBeNull();
    expect(o.description).toBe('Main St');
    expect(o.label).toContain('not confirmed sidewalk closure');
  });
  it('311 Closed stays unverified_report and omits address', () => {
    const o = normalize311Row(row311)!;
    expect(o.verification_status).toBe('unverified_report');
    expect(o.metadata.status).toBe('Closed');
    expect(JSON.stringify(o)).not.toContain('PRIVATE');
    expect(o.description).toBe('Resident report (unverified): Lifted slab here');
    expect(normalize311Row({ ...row311, service_name: 'Graffiti' })).toBeNull();
    expect(normalize311Row({ ...row311, lat: '0', lng: '0' })).toBeNull();
  });
  it('311 date converts Pacific to UTC', () => {
    expect(pacificToUtcIso('2026-07-01 08:30:00.000')).toBe('2026-07-01T15:30:00.000Z'); // PDT
    expect(pacificToUtcIso('2026-01-15 08:30:00.000')).toBe('2026-01-15T16:30:00.000Z'); // PST
  });
  it('sanitizeText strips HTML and control chars', () => {
    expect(sanitizeText('a<script>x</script>\u0000b\n\n c')).toBe('a x b c');
    expect(sanitizeText('x'.repeat(500), 10)).toHaveLength(10);
  });
});

describe('guardrails', () => {
  it('rejects AI candidate with confirmed_blocking_edge or human_reviewed; accepts ai_candidate+unknown', async () => {
    const ai = mk({ id: 'ai:1', source_kind: 'street_imagery_ai', verification_status: 'ai_candidate', routing_impact: 'unknown' });
    const r = await upsertObservations([
      ai,
      { ...ai, id: 'ai:2', routing_impact: 'confirmed_blocking_edge' },
      { ...ai, id: 'ai:3', verification_status: 'human_reviewed' },
    ]);
    expect([r.inserted, r.rejected]).toEqual([1, 2]);
  });
});

describe('geo', () => {
  it('distanceToLine sanity', () => {
    const line: [number, number][] = [[-117.17, 32.72], [-117.16, 32.72]];
    expect(distanceToLine([-117.165, 32.72], line)).toBeLessThan(0.5);
    const d = distanceToLine([-117.165, 32.7209], line);
    expect(d).toBeGreaterThan(95);
    expect(d).toBeLessThan(105);
    expect(Math.abs(haversineMeters([-117.165, 32.7209], [-117.165, 32.72]) - d)).toBeLessThan(1);
  });
});
