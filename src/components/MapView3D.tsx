"use client";

import { useEffect, useRef, useState } from "react";
import type { Map as MLMap, GeoJSONSource, MapLayerMouseEvent } from "maplibre-gl";
import type { BarrierObservation, BBox } from "@/lib/ui/barrierTypes";
import type { LatLon } from "@/lib/ui/routeClient";
import { SOURCE_COLORS, SOURCE_GLYPHS } from "@/lib/ui/caveats";
import { STUDY_BBOX } from "@/lib/data/studyArea";
import { stairBlocks } from "@/lib/map/extrude";
import type { AccessCollection } from "@/lib/map/osmAccess";

/**
 * MapLibre map for downtown: flat by default, optional 3D tilt with extruded buildings
 * and stairways. OSM accessibility context (kerbs, crossings, steps, elevators) is
 * community-mapped and unverified — shown as context, never as barrier evidence.
 */

const STYLE_URL = "https://tiles.openfreemap.org/styles/positron";
const ACCESS_URL = "/data/downtown-access.geojson";
const FONT = ["Noto Sans Bold"];

interface Props {
  observations: BarrierObservation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onBoundsChange: (bbox: BBox) => void;
  route?: [number, number][] | null;
  start?: LatLon | null;
  end?: LatLon | null;
  picking?: boolean;
  onPick?: (p: LatLon) => void;
}

/** Context layer groups the user can toggle. Labels are shown in the legend (not color-only). */
const GROUPS = [
  { key: "buildings", label: "Buildings (3D)", layers: ["buildings-3d"] },
  { key: "paths", label: "Sidewalks & crossings", layers: ["acc-sidewalk", "acc-crossing-line", "acc-footway", "acc-crossing"] },
  { key: "kerbs", label: "Curb ramps / kerbs", layers: ["acc-kerb", "acc-kerb-label"] },
  { key: "steps", label: "Stairs", layers: ["acc-steps-line", "acc-steps-3d"] },
  { key: "elevators", label: "Elevators", layers: ["acc-elevator", "acc-elevator-label"] },
] as const;
type GroupKey = (typeof GROUPS)[number]["key"];

/** Read map colors from CSS tokens so a future theme only overrides :root variables. */
function tokens() {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  return {
    building: v("--map-building", "#d6dbe3"),
    buildingTop: v("--map-building-top", "#c3cad6"),
    sidewalk: v("--map-sidewalk", "#94a3b8"),
    crossing: v("--map-crossing", "#475569"),
    steps: v("--map-steps", "#c2410c"),
    kerbLowered: v("--map-kerb-lowered", "#0f766e"),
    kerbRaised: v("--map-kerb-raised", "#b45309"),
    kerbUnknown: v("--map-kerb-unknown", "#64748b"),
    elevator: v("--map-elevator", "#6d28d9"),
    route: v("--accent", "#1d4ed8"),
    pinStart: v("--pin-start", "#15803d"),
    pinEnd: v("--pin-end", "#b91c1c"),
    halo: v("--panel", "#ffffff"),
    ink: v("--fg", "#0f172a"),
  };
}

const empty = { type: "FeatureCollection" as const, features: [] as any[] };

function barrierFC(obs: BarrierObservation[], selectedId: string | null) {
  return {
    type: "FeatureCollection" as const,
    features: obs.map((o) => ({
      type: "Feature" as const,
      geometry: o.geometry as any,
      properties: { id: o.id, color: SOURCE_COLORS[o.source_kind], glyph: SOURCE_GLYPHS[o.source_kind], sel: o.id === selectedId ? 1 : 0 },
    })),
  };
}

const ACCESS_TEXT: Record<string, string> = {
  steps: "Stairs", sidewalk: "Sidewalk", crossing_line: "Crosswalk", footway: "Footpath", pedestrian_area: "Pedestrian street",
  kerb_lowered: "Lowered curb (curb ramp)", kerb_raised: "Raised curb (no ramp)", kerb_unknown: "Curb, type unknown",
  crossing: "Crossing point", elevator: "Elevator",
};

export default function MapView3D(p: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  const [ready, setReady] = useState(false);
  const [tilted, setTilted] = useState(false);
  const [shown, setShown] = useState<Record<GroupKey, boolean>>({ buildings: true, paths: true, kerbs: true, steps: true, elevators: true });
  const [accessNote, setAccessNote] = useState<string | null>(null);
  const cbs = useRef(p);
  cbs.current = p;

  // ---- init -----------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ml = (await import("maplibre-gl")).default;
      if (cancelled || !el.current || map.current) return;
      const [w, s, e, n] = STUDY_BBOX;
      const pad = 0.004;
      const m = new ml.Map({
        container: el.current,
        style: STYLE_URL,
        center: [(w + e) / 2, (s + n) / 2],
        zoom: 16,
        minZoom: 14.5,
        maxZoom: 20,
        maxPitch: 65,
        maxBounds: [[w - pad, s - pad], [e + pad, n + pad]],
        attributionControl: { compact: true, customAttribution: "Accessibility context: © OpenStreetMap contributors (ODbL), unverified" },
        dragRotate: true,
        keyboard: true,
      });
      m.addControl(new ml.NavigationControl({ visualizePitch: true }), "top-right");
      m.addControl(new ml.ScaleControl({ unit: "imperial" }), "bottom-left");
      map.current = m;

      m.on("load", async () => {
        const t = tokens();
        // Hide the flat building fill; we draw our own extrusion (flat when pitch = 0).
        for (const l of m.getStyle().layers ?? []) if ((l as any)["source-layer"] === "building") m.setLayoutProperty(l.id, "visibility", "none");
        const firstLabel = m.getStyle().layers?.find((l) => l.type === "symbol")?.id;

        m.addLayer({
          id: "buildings-3d", type: "fill-extrusion", source: "openmaptiles", "source-layer": "building", minzoom: 14,
          paint: {
            "fill-extrusion-color": ["interpolate", ["linear"], ["coalesce", ["get", "render_height"], 0], 0, t.building, 60, t.buildingTop],
            "fill-extrusion-height": ["coalesce", ["get", "render_height"], 6],
            "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
            "fill-extrusion-opacity": 0.85,
          },
        }, firstLabel);

        m.addSource("study", { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [[w, s], [e, s], [e, n], [w, n], [w, s]] } } });
        m.addLayer({ id: "study-outline", type: "line", source: "study", paint: { "line-color": t.ink, "line-width": 1.5, "line-dasharray": [4, 3], "line-opacity": 0.6 } });

        // OSM accessibility context (static snapshot).
        let access: AccessCollection | null = null;
        try { access = await (await fetch(ACCESS_URL)).json(); } catch { setAccessNote("Sidewalk/curb detail layer unavailable."); }
        const fc = access ?? (empty as any);
        m.addSource("access", { type: "geojson", data: fc });
        const steps = (fc.features as any[]).filter((f) => f.properties.kind === "steps" && f.geometry.type === "LineString");
        m.addSource("steps3d", { type: "geojson", data: { type: "FeatureCollection", features: steps.flatMap((f) => stairBlocks(f.geometry.coordinates, f.properties.osm_id, f.properties.step_count)) } });

        const kind = (k: string | string[]) => (Array.isArray(k) ? ["in", ["get", "kind"], ["literal", k]] : ["==", ["get", "kind"], k]) as any;
        const zoomW = (a: number, b: number) => ["interpolate", ["linear"], ["zoom"], 15, a, 19, b] as any;

        m.addLayer({ id: "acc-footway", type: "line", source: "access", filter: kind(["footway", "pedestrian_area"]), paint: { "line-color": t.sidewalk, "line-width": zoomW(0.6, 2.5), "line-dasharray": [2, 1.5] } });
        m.addLayer({ id: "acc-sidewalk", type: "line", source: "access", filter: kind("sidewalk"), paint: { "line-color": t.sidewalk, "line-width": zoomW(0.8, 4) } });
        m.addLayer({ id: "acc-crossing-line", type: "line", source: "access", filter: kind("crossing_line"), paint: { "line-color": t.crossing, "line-width": zoomW(1, 5), "line-dasharray": [1, 0.8] } });
        m.addLayer({ id: "acc-steps-line", type: "line", source: "access", filter: kind("steps"), paint: { "line-color": t.steps, "line-width": zoomW(2, 7) } });
        m.addLayer({ id: "acc-steps-3d", type: "fill-extrusion", source: "steps3d", paint: { "fill-extrusion-color": t.steps, "fill-extrusion-height": ["get", "height"], "fill-extrusion-base": ["get", "base"], "fill-extrusion-opacity": 0.9 } });
        m.addLayer({
          id: "acc-crossing", type: "circle", source: "access", filter: kind("crossing"), minzoom: 16,
          paint: { "circle-radius": zoomW(1.5, 5), "circle-color": t.halo, "circle-stroke-color": t.crossing, "circle-stroke-width": ["case", ["==", ["get", "tactile_paving"], "yes"], 2.5, 1] },
        });
        m.addLayer({
          id: "acc-kerb", type: "circle", source: "access", filter: kind(["kerb_lowered", "kerb_raised", "kerb_unknown"]), minzoom: 15.5,
          paint: {
            "circle-radius": zoomW(2, 7),
            "circle-color": ["match", ["get", "kind"], "kerb_lowered", t.kerbLowered, "kerb_raised", t.kerbRaised, t.kerbUnknown],
            "circle-stroke-color": t.halo, "circle-stroke-width": 1,
          },
        });
        // Shape cue in addition to color: ▼ lowered, ▲ raised, ? unknown.
        m.addLayer({
          id: "acc-kerb-label", type: "symbol", source: "access", filter: kind(["kerb_lowered", "kerb_raised", "kerb_unknown"]), minzoom: 18,
          layout: { "text-field": ["match", ["get", "kind"], "kerb_lowered", "▼", "kerb_raised", "▲", "?"], "text-font": FONT, "text-size": 9, "text-allow-overlap": true },
          paint: { "text-color": t.halo },
        });
        m.addLayer({ id: "acc-elevator", type: "circle", source: "access", filter: kind("elevator"), paint: { "circle-radius": 9, "circle-color": t.elevator, "circle-stroke-color": t.halo, "circle-stroke-width": 2 } });
        m.addLayer({ id: "acc-elevator-label", type: "symbol", source: "access", filter: kind("elevator"), layout: { "text-field": "E", "text-font": FONT, "text-size": 11, "text-allow-overlap": true }, paint: { "text-color": t.halo } });

        // Route + barriers above context.
        m.addSource("route", { type: "geojson", data: empty });
        m.addLayer({ id: "route-casing", type: "line", source: "route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": t.halo, "line-width": 10 } });
        m.addLayer({ id: "route-line", type: "line", source: "route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": t.route, "line-width": 6 } });

        m.addSource("barriers", { type: "geojson", data: empty });
        m.addLayer({ id: "barrier-lines", type: "line", source: "barriers", filter: ["!=", ["geometry-type"], "Point"], paint: { "line-color": ["get", "color"], "line-width": ["case", ["==", ["get", "sel"], 1], 9, 5], "line-dasharray": [3, 2] } });
        m.addLayer({
          id: "barrier-points", type: "circle", source: "barriers", filter: ["==", ["geometry-type"], "Point"],
          paint: {
            "circle-radius": ["case", ["==", ["get", "sel"], 1], 15, 11], "circle-color": ["get", "color"],
            "circle-stroke-color": ["case", ["==", ["get", "sel"], 1], t.ink, t.halo], "circle-stroke-width": ["case", ["==", ["get", "sel"], 1], 4, 2],
            "circle-pitch-alignment": "viewport",
          },
        });
        m.addLayer({
          id: "barrier-glyphs", type: "symbol", source: "barriers", filter: ["==", ["geometry-type"], "Point"],
          layout: { "text-field": ["get", "glyph"], "text-font": FONT, "text-size": 9, "text-allow-overlap": true, "text-ignore-placement": true },
          paint: { "text-color": t.halo },
        });

        m.addSource("pins", { type: "geojson", data: empty });
        m.addLayer({ id: "pins", type: "circle", source: "pins", paint: { "circle-radius": 13, "circle-color": ["match", ["get", "k"], "start", t.pinStart, t.pinEnd], "circle-stroke-color": t.halo, "circle-stroke-width": 2 } });
        m.addLayer({ id: "pins-label", type: "symbol", source: "pins", layout: { "text-field": ["match", ["get", "k"], "start", "A", "B"], "text-font": FONT, "text-size": 13, "text-allow-overlap": true }, paint: { "text-color": t.halo } });

        // Interactions.
        const clickable = ["barrier-points", "barrier-lines"];
        const ctx = ["acc-steps-line", "acc-kerb", "acc-crossing", "acc-elevator"];
        for (const id of [...clickable, ...ctx]) {
          m.on("mouseenter", id, () => { m.getCanvas().style.cursor = "pointer"; });
          m.on("mouseleave", id, () => { m.getCanvas().style.cursor = cbs.current.picking ? "crosshair" : ""; });
        }
        m.on("click", (ev: MapLayerMouseEvent) => {
          if (cbs.current.picking) { cbs.current.onPick?.({ lat: ev.lngLat.lat, lon: ev.lngLat.lng }); return; }
          const hit = m.queryRenderedFeatures(ev.point, { layers: clickable.filter((l) => m.getLayer(l)) })[0];
          if (hit?.properties?.id) { cbs.current.onSelect(String(hit.properties.id)); return; }
          const c = m.queryRenderedFeatures(ev.point, { layers: ctx.filter((l) => m.getLayer(l)) })[0];
          if (c) new ml.Popup({ closeButton: true, maxWidth: "260px" }).setLngLat(ev.lngLat).setDOMContent(accessPopup(c.properties as any)).addTo(m);
        });
        const emit = () => { const b = m.getBounds(); cbs.current.onBoundsChange([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]); };
        m.on("moveend", emit);
        emit();
        setReady(true);
      });
    })();
    return () => { cancelled = true; map.current?.remove(); map.current = null; };
  }, []);

  // ---- data sync ------------------------------------------------------------
  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    (m.getSource("barriers") as GeoJSONSource | undefined)?.setData(barrierFC(p.observations, p.selectedId) as any);
  }, [p.observations, p.selectedId, ready]);

  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    const r = p.route && p.route.length >= 2 ? p.route : null;
    (m.getSource("route") as GeoJSONSource | undefined)?.setData(r ? ({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: r } } as any) : (empty as any));
    if (r) {
      const xs = r.map((c) => c[0]), ys = r.map((c) => c[1]);
      m.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], { padding: 60, maxZoom: 18, pitch: m.getPitch() });
    }
    const pins = ([[p.start, "start"], [p.end, "end"]] as const)
      .filter(([pt]) => pt)
      .map(([pt, k]) => ({ type: "Feature", properties: { k }, geometry: { type: "Point", coordinates: [pt!.lon, pt!.lat] } }));
    (m.getSource("pins") as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: pins } as any);
  }, [p.route, p.start, p.end, ready]);

  // Pan to a selection made from the list.
  useEffect(() => {
    const m = map.current;
    const o = p.observations.find((x) => x.id === p.selectedId);
    if (!ready || !m || !o) return;
    const g = o.geometry;
    const pt = g.type === "Point" ? g.coordinates : g.type === "LineString" ? g.coordinates[0] : g.coordinates[0]?.[0];
    if (pt && !m.getBounds().contains(pt as [number, number])) m.easeTo({ center: pt as [number, number] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.selectedId, ready]);

  useEffect(() => { if (map.current) map.current.getCanvas().style.cursor = p.picking ? "crosshair" : ""; }, [p.picking]);

  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    for (const g of GROUPS) for (const id of g.layers) if (m.getLayer(id)) m.setLayoutProperty(id, "visibility", shown[g.key] ? "visible" : "none");
  }, [shown, ready]);

  const toggle3d = () => {
    const m = map.current;
    if (!m) return;
    const next = !tilted;
    setTilted(next);
    m.easeTo({ pitch: next ? 55 : 0, bearing: next ? -20 : 0, duration: 700 });
  };

  return (
    <div className="map3d">
      <div ref={el} className="map" role="region" aria-label="Map of downtown San Diego with potential accessibility barriers" />
      <div className="map-overlay">
        <button type="button" aria-pressed={tilted} onClick={toggle3d}>{tilted ? "Flat view" : "3D view"}</button>
        <details className="map-layers">
          <summary>Map details</summary>
          <ul>
            {GROUPS.map((g) => (
              <li key={g.key}>
                <label>
                  <input type="checkbox" checked={shown[g.key]} onChange={() => setShown((s) => ({ ...s, [g.key]: !s[g.key] }))} />
                  <span className={`swatch swatch--${g.key}`} aria-hidden="true" /> {g.label}
                </label>
              </li>
            ))}
          </ul>
          <p className="small muted">
            Curb ramps: ▼ lowered · ▲ raised · ? unknown. Sidewalk, curb and stair detail is community-mapped (OpenStreetMap), may be incomplete, and is not verified. Missing detail means unknown.
          </p>
          {accessNote && <p className="small error">{accessNote}</p>}
        </details>
      </div>
    </div>
  );
}

/** Popup content built with DOM APIs (textContent), never innerHTML from data. */
function accessPopup(pr: Record<string, any>): HTMLElement {
  const root = document.createElement("div");
  root.className = "access-popup";
  const h = document.createElement("strong");
  h.textContent = ACCESS_TEXT[pr.kind] ?? "Pedestrian feature";
  root.appendChild(h);
  const rows: [string, string][] = [];
  if (pr.kind === "steps") {
    rows.push(["Steps", pr.step_count ? String(pr.step_count) : "count unknown"], ["Handrail", pr.handrail], ["Ramp alongside", pr.ramp]);
  }
  if (pr.kind === "crossing") rows.push(["Signals", pr.signals], ["Tactile paving", pr.tactile_paving]);
  if (String(pr.kind).startsWith("kerb")) rows.push(["Tactile paving", pr.tactile_paving]);
  rows.push(["Wheelchair tag", pr.wheelchair]);
  const dl = document.createElement("dl");
  for (const [k, v] of rows) {
    const dt = document.createElement("dt"); dt.textContent = k;
    const dd = document.createElement("dd"); dd.textContent = v;
    dl.append(dt, dd);
  }
  root.appendChild(dl);
  const note = document.createElement("p");
  note.textContent = `OpenStreetMap ${pr.osm_id} · community-mapped, unverified.`;
  root.appendChild(note);
  return root;
}
