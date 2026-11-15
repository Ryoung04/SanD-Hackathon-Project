import { describe, it, expect } from 'vitest';
import { normalizeProwagAps, normalizeProwagRamp, validateObservation } from '@/lib/data/normalizers';
import { STUDY_BBOX } from '@/lib/data/studyArea';

const feat = (attrs: Record<string, unknown>, x = -117.16, y = 32.72) => ({ attributes: { OBJECTID: 7, NODE_ID: 99, ...attrs }, geometry: { x, y } });

describe('normalizeProwagAps', () => {
  it('maps APS deficit to an informational crossing_issue with its own id namespace', () => {
    const o = normalizeProwagAps(feat({ APS_DEFICIT: 3, RAMP_DEFICIT: 1 }), '2026-06-24T01:02:33.413Z')!;
    expect(o.id).toBe('city_gis:prowag1:7');
    expect(o.category).toBe('crossing_issue');
    expect(o.verification_status).toBe('official_inventory');
    expect(o.routing_impact).toBe('informational');
    expect(o.source_url).toMatch(/FeatureServer\/1$/);
    expect(o.label).toMatch(/3 crossings/);
    expect(validateObservation(o)).toEqual({ ok: true, errors: [] });
    // a ramp record for the same node does not collide
    expect(normalizeProwagRamp(feat({ RAMP_DEFICIT: 1, RAMPS_REQUIRED: 4 }), null)!.id).not.toBe(o.id);
  });
  it('drops zero/missing deficits and bad geometry', () => {
    expect(normalizeProwagAps(feat({ APS_DEFICIT: 0 }), null)).toBeNull();
    expect(normalizeProwagAps(feat({}), null)).toBeNull();
    expect(normalizeProwagAps(feat({ APS_DEFICIT: 2 }, 0, 0), null)).toBeNull();
  });
});

describe('STUDY_BBOX', () => {
  it('covers downtown core and Golden Hill demo notice', () => {
    const [w, s, e, n] = STUDY_BBOX;
    for (const [lon, lat] of [[-117.1674, 32.7188], [-117.14002, 32.71712]]) {
      expect(lon > w && lon < e && lat > s && lat < n).toBe(true);
    }
  });
});
