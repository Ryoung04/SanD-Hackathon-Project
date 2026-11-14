"use client";

import { useState } from "react";
import type { BarrierObservation } from "@/lib/ui/barrierTypes";
import { SOURCE_GLYPHS, SOURCE_LABELS } from "@/lib/ui/caveats";
import { STUDY_BBOX } from "@/lib/data/studyArea";
import {
  EVIDENCE_GROUPS, inBBox, formatDistance, formatDuration, formatLatLon, groupNearby, parseLatLon,
  type LatLon, type RouteProfile, type RouteResult,
} from "@/lib/ui/routeClient";

export type PickTarget = "start" | "end" | null;

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
  observations: BarrierObservation[];
  onSelect: (id: string) => void;
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
            <option value="wheelchair_preference">Prefer wheelchair-friendly paths</option>
            <option value="pedestrian">Standard walking</option>
          </select>
        </label>
        <p className="muted small">A preference only. Choosing it does not make the route verified accessible.</p>
        <div className="row">
          <button type="submit" className="btn-primary" disabled={!p.start || !p.end || p.loading}>
            {p.loading ? "Finding route…" : "Get route"}
          </button>
          <button type="button" onClick={p.onClear}>Clear</button>
        </div>
      </form>

      <div aria-live="polite">{p.result && <RouteResultView result={p.result} observations={p.observations} onSelect={p.onSelect} />}</div>
    </section>
  );
}

function PointField({ label, value, onChange, picking, onPick }: {
  label: string; value: LatLon | null; onChange: (p: LatLon | null) => void; picking: boolean; onPick: () => void;
}) {
  const [text, setText] = useState("");
  const [shown, setShown] = useState<LatLon | null>(null);
  // Sync text when the value is set from a map click.
  if (value !== shown) { setShown(value); setText(value ? formatLatLon(value) : ""); }
  const parsed = parseLatLon(text);
  const invalid = text.trim() !== "" && !parsed;
  const outside = !!parsed && !inBBox(parsed, STUDY_BBOX);
  const id = `pt-${label.toLowerCase()}`;
  return (
    <div className="field">
      <label htmlFor={id}>{label} (lat, lon)</label>
      <div className="row">
        <input
          id={id} value={text} placeholder="32.7157, -117.1611" aria-invalid={invalid || outside}
          onChange={(e) => {
            setText(e.target.value);
            const v = parseLatLon(e.target.value);
            const ok = v && inBBox(v, STUDY_BBOX) ? v : null;
            setShown(ok); onChange(ok);
          }}
        />
        <button type="button" aria-pressed={picking} onClick={onPick}>{picking ? "Click map…" : "Pick on map"}</button>
      </div>
      {invalid && <span className="error small">Enter latitude, longitude.</span>}
      {outside && <span className="error small">Outside the downtown study area shown on the map.</span>}
    </div>
  );
}

function RouteResultView({ result, observations, onSelect }: { result: RouteResult; observations: BarrierObservation[]; onSelect: (id: string) => void }) {
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
  return (
    <div className="route-result">
      <h3>Pedestrian route — accessibility not verified</h3>
      <p>
        {formatDistance(result.distance_m)} · about {formatDuration(result.duration_s)} · via {result.provider}
      </p>
      <p className="caveat small">{result.coverage_note}. Unmarked segments are unknown, not accessible.</p>

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
      <p className="muted small">Automatic rerouting around barriers is off: records are not matched to exact sidewalk edges.</p>
    </div>
  );
}
