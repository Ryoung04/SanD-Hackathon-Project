"use client";

import { useState } from "react";
import type { BarrierObservation } from "@/lib/ui/barrierTypes";
import { SOURCE_GLYPHS, SOURCE_LABELS } from "@/lib/ui/caveats";
import { STUDY_BBOX } from "@/lib/data/studyArea";
import {
  EVIDENCE_GROUPS, inBBox, formatDistance, formatDuration, formatLatLon, groupNearby, parseLatLon,
  type LatLon, type RouteProfile, type RouteResult,
} from "@/lib/ui/routeClient";
import type { ContextGroup } from "@/lib/map/routeContext";
import PlaceSearch from "./PlaceSearch";

export type PickTarget = "start" | "end" | null;

/** Preset demo trip: real downtown places inside STUDY_BBOX (coords from the OSM places snapshot). */
export const SAMPLE_TRIP = {
  label: "Santa Fe Depot → Horton Plaza Park",
  start: { lat: 32.717246, lon: -117.169838 },
  end: { lat: 32.715101, lon: -117.161538 },
};

const PROFILE_TEXT: Record<RouteProfile, string> = {
  wheelchair_preference: "Prefer wheelchair-friendly paths",
  avoid_stairs: "Avoid mapped stairs and hills (strongest)",
  pedestrian: "Standard walking",
};

interface Props {
  start: LatLon | null;
  end: LatLon | null;
  onStart: (p: LatLon | null) => void;
  onEnd: (p: LatLon | null) => void;
  picking: PickTarget;
  onPick: (t: PickTarget) => void;
  result: RouteResult | null;
  loading: boolean;
  onSubmit: (profile: RouteProfile) => void;
  onClear: () => void;
  /** Fill in SAMPLE_TRIP and route it with the chosen profile. */
  onSample: (profile: RouteProfile) => void;
  observations: BarrierObservation[];
  onSelect: (id: string) => void;
  /** OSM/feed context near the route (null = still loading or unavailable). */
  context: ContextGroup[] | null;
  contextError: string | null;
  /** Pan the map to a point [lon, lat]. */
  onFocus: (at: [number, number]) => void;
}

/** Origin/destination form + baseline route result with near-route warnings (warning-only, no rerouting). */
export default function RoutePlanner(p: Props) {
  const [profile, setProfile] = useState<RouteProfile>("wheelchair_preference");

  return (
    <section className="panel route-planner" aria-labelledby="route-h">
      <h2 id="route-h">Plan a trip</h2>
      <form
        onSubmit={(e) => { e.preventDefault(); if (p.start && p.end) p.onSubmit(profile); }}
        className="route-form"
      >
        <PointField label="Start" value={p.start} onChange={p.onStart} picking={p.picking === "start"} onPick={() => p.onPick(p.picking === "start" ? null : "start")} />
        <PointField label="Destination" value={p.end} onChange={p.onEnd} picking={p.picking === "end"} onPick={() => p.onPick(p.picking === "end" ? null : "end")} />
        <label className="field">
          <span>Preference</span>
          <select value={profile} onChange={(e) => setProfile(e.target.value as RouteProfile)}>
            {(Object.keys(PROFILE_TEXT) as RouteProfile[]).map((k) => <option key={k} value={k}>{PROFILE_TEXT[k]}</option>)}
          </select>
        </label>
        <p className="muted small">
          A preference only. Stairs or slopes missing from the map can&apos;t be avoided, and no choice makes the route verified accessible.
        </p>
        <div className="row">
          <button type="submit" className="btn-primary" disabled={!p.start || !p.end || p.loading}>
            {p.loading ? "Finding route…" : "Get route"}
          </button>
          <button type="button" onClick={p.onClear}>Clear</button>
        </div>
        <button type="button" className="link-button small" onClick={() => p.onSample(profile)} disabled={p.loading}>
          Try a sample trip: {SAMPLE_TRIP.label}
        </button>
      </form>

      <div aria-live="polite">
        {p.result && <RouteResultView {...p} result={p.result} />}
      </div>
    </section>
  );
}

function PointField({ label, value, onChange, picking, onPick }: {
  label: string; value: LatLon | null; onChange: (p: LatLon | null) => void; picking: boolean; onPick: () => void;
}) {
  const [text, setText] = useState("");
  const [shown, setShown] = useState<LatLon | null>(null);
  const [placeName, setPlaceName] = useState<string | null>(null);
  // Sync text when the value is set from a map click, search, or the sample trip.
  if (value !== shown) { setShown(value); setText(value ? formatLatLon(value) : ""); if (!value) setPlaceName(null); }
  const parsed = parseLatLon(text);
  const invalid = text.trim() !== "" && !parsed;
  const outside = !!parsed && !inBBox(parsed, STUDY_BBOX);
  const id = `pt-${label.toLowerCase()}`;
  return (
    <fieldset className="field point-field">
      <legend>{label}</legend>
      <PlaceSearch
        id={`${id}-search`} label="Search a place or intersection"
        onSelect={(pt, name) => {
          const ok = inBBox(pt, STUDY_BBOX) ? pt : null;
          setPlaceName(ok ? name : null);
          onChange(ok);
        }}
      />
      {placeName && <p className="small muted">Selected: {placeName}</p>}
      <label htmlFor={id} className="small">or enter latitude, longitude</label>
      <div className="row">
        <input
          id={id} value={text} placeholder="32.7157, -117.1611" aria-invalid={invalid || outside}
          onChange={(e) => {
            setText(e.target.value);
            setPlaceName(null);
            const v = parseLatLon(e.target.value);
            const ok = v && inBBox(v, STUDY_BBOX) ? v : null;
            setShown(ok); onChange(ok);
          }}
        />
        <button type="button" aria-pressed={picking} onClick={onPick}>{picking ? "Click map…" : "Pick on map"}</button>
      </div>
      {invalid && <span className="error small">Enter latitude, longitude.</span>}
      {outside && <span className="error small">Outside the downtown study area shown on the map.</span>}
    </fieldset>
  );
}

const signed = (n: number, fmt: (x: number) => string) => (n === 0 ? "the same" : `${n > 0 ? "+" : "−"}${fmt(Math.abs(n))}`);

function RouteResultView({ result, observations, onSelect, context, contextError, onFocus }: Props & { result: RouteResult }) {
  if (result.status !== "route_available") {
    return (
      <div className="route-result route-result--unavailable" role="status">
        <h3>Route unavailable</h3>
        <p>{result.reason}. The map and reports still work; try again later or pick nearby points.</p>
      </div>
    );
  }
  const details = result.nearby_details ?? result.nearby_barriers.map((id) => ({ id, distance_m: NaN, match_method: "" }));
  const groups = groupNearby(details, observations);
  const threshold = result.nearby_threshold_m ?? 30;
  const cmp = result.comparison;
  const steps = result.steps ?? [];
  const coords = result.route.coordinates;
  return (
    <div className="route-result">
      <h3>Pedestrian route — accessibility not verified</h3>
      <p>
        {formatDistance(result.distance_m)} · about {formatDuration(result.duration_s)} · via {result.provider}
        {result.profile ? ` · ${PROFILE_TEXT[result.profile]}` : ""}
      </p>
      {cmp && (
        <p className="small">
          Standard walking route for the same trip: {formatDistance(cmp.distance_m)}, about {formatDuration(cmp.duration_s)}.
          {" "}This route is {signed(result.distance_m - cmp.distance_m, formatDistance)}
          {result.distance_m !== cmp.distance_m ? ` (${signed(result.duration_s - cmp.duration_s, formatDuration)})` : ""}.
          {" "}<span className="muted">Both are real provider routes; the difference is not a safety score.</span>
        </p>
      )}
      {result.route_features && <p className="small">{describeFeatures(result.route_features, result.profile)}</p>}
      {result.fallback_reason && <p className="muted small">Used the backup router: {result.fallback_reason}.</p>}
      <p className="caveat small">{result.coverage_note}. Unmarked segments are unknown, not accessible.{result.data_note ? ` ${result.data_note}` : ""}</p>

      {steps.length > 0 && (
        <details className="route-steps">
          <summary>Step-by-step directions ({steps.length})</summary>
          <ol>
            {steps.map((s, i) => {
              const at = coords[Math.min(s.begin_index, coords.length - 1)];
              return (
                <li key={i}>
                  <button type="button" className="link-button" onClick={() => at && onFocus(at)}>
                    {s.instruction}
                  </button>
                  {s.distance_m > 0 && <span className="muted small"> · {formatDistance(s.distance_m)}</span>}
                </li>
              );
            })}
          </ol>
          <p className="muted small">Directions from {result.provider} (OpenStreetMap). Select a step to show it on the map.</p>
        </details>
      )}

      <h3>Potential barriers near this route ({details.length})</h3>
      {result.nearby_status === "unavailable" ? (
        <p className="error">Barrier records could not be checked for this route.</p>
      ) : details.length === 0 ? (
        <p className="muted">No records within ~{threshold} m. This is not evidence the route is barrier-free.</p>
      ) : (
        <>
          <p className="muted small">Within ~{threshold} m (approximate). Nearby does not mean you will encounter it.</p>
          {EVIDENCE_GROUPS.map((g) =>
            groups[g.key].length ? (
              <div key={g.key} className="nearby-group">
                <h4>{g.label} ({groups[g.key].length})</h4>
                <ul className="obs-list">
                  {groups[g.key].map((n) => (
                    <li key={n.id}>
                      <button type="button" onClick={() => onSelect(n.id)}>
                        {n.obs && <span className="glyph" aria-hidden="true">{SOURCE_GLYPHS[n.obs.source_kind]}</span>}
                        <span>
                          {n.obs ? n.obs.label : n.id}
                          <span className="muted small">
                            {n.obs ? ` · ${SOURCE_LABELS[n.obs.source_kind]}` : " · details not loaded"}
                            {Number.isFinite(n.distance_m) ? ` · ~${Math.round(n.distance_m)} m from route` : ""}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null,
          )}
        </>
      )}

      <RouteContextView context={context} error={contextError} onFocus={onFocus} />
      <p className="muted small">Automatic rerouting around barriers is off: records are not matched to exact sidewalk edges.</p>
    </div>
  );
}

/** Plain-language summary of what the route passes through (graph router). */
function describeFeatures(f: NonNullable<Extract<RouteResult, { status: "route_available" }>["route_features"]>, profile?: RouteProfile): string {
  const parts: string[] = [];
  const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
  if (f.stairs) parts.push(`uses ${n(f.stairs, "stairway", "stairways")}`);
  if (f.passages) parts.push(`goes through ${n(f.passages, "building passage", "building passages")}`);
  if (f.corridors) parts.push(`uses ${n(f.corridors, "indoor corridor", "indoor corridors")}`);
  if (f.open_areas) parts.push(`crosses ${n(f.open_areas, "open plaza area", "open plaza areas")}`);
  if (f.road_no_sidewalk_m) parts.push(`~${f.road_no_sidewalk_m} m along streets with no sidewalk mapped`);
  const stairNote = profile && profile !== "pedestrian" ? " No mapped stairs are used." : "";
  return parts.length ? `This route ${parts.join(", ")}.${stairNote}` : `Sidewalks, footpaths and crosswalks only.${stairNote}`;
}

const CONTEXT_PREVIEW = 6;

/** Map-context findings (OSM/feed). Cautions list items; helpful features show a count and a few items. */
function RouteContextView({ context, error, onFocus }: { context: ContextGroup[] | null; error: string | null; onFocus: (at: [number, number]) => void }) {
  return (
    <div className="route-context">
      <h3>Map details along this route</h3>
      <p className="muted small">From OpenStreetMap (community-mapped) and any connected access feed. Unverified context, separate from the barrier records above.</p>
      {error ? (
        <p className="error small">Map details unavailable: {error}</p>
      ) : !context ? (
        <p className="muted small">Checking map details…</p>
      ) : context.length === 0 ? (
        <p className="muted small">No stairs, curbs or slopes are mapped near this route. That doesn&apos;t mean there are none.</p>
      ) : (
        context.map((g) => (
          <div key={g.key} className={`nearby-group context-group context-group--${g.tone}`}>
            <h4>
              <span aria-hidden="true">{g.tone === "caution" ? "⚠ " : "ℹ "}</span>
              {g.label} ({g.hits.length})
            </h4>
            <ul className="obs-list">
              {g.hits.slice(0, CONTEXT_PREVIEW).map((h) => (
                <li key={h.id}>
                  <button type="button" onClick={() => onFocus(h.at)}>
                    <span>
                      {describeHit(h)}
                      <span className="muted small"> · ~{h.distance_m} m from route · {h.source}{h.method === "inferred" || h.method === "ai_estimate" ? " (estimate)" : ""}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {g.hits.length > CONTEXT_PREVIEW && <p className="muted small">…and {g.hits.length - CONTEXT_PREVIEW} more, shown on the map.</p>}
          </div>
        ))
      )}
    </div>
  );
}

function describeHit(h: ContextGroup["hits"][number]): string {
  if (h.kind === "steps") {
    const rise = h.rise_m ? `, ~${h.rise_m} m height change (estimate)` : "";
    return h.step_count ? `Stairs, ${h.step_count} steps${rise}` : `Stairs, step count unknown${rise}`;
  }
  if (h.slope_pct !== null && h.slope_pct > 12) return `Very steep ~${Math.round(h.slope_pct)}% (possibly unmapped stairs)`;
  if (h.slope_pct !== null && h.slope_pct > 8.33) return `Slope ~${Math.round(h.slope_pct * 10) / 10}%`;
  const names: Record<string, string> = {
    kerb_raised: "Raised curb", kerb_unknown: "Curb, type unknown", ramp_candidate: "Possible curb ramp",
    kerb_lowered: "Lowered curb (curb ramp)", curb_ramp: "Curb ramp", ramp: "Ramp / sloped path", elevator: "Elevator",
  };
  return names[h.kind] ?? "Map detail";
}
