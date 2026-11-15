"use client";

import { useEffect, useRef, useState } from "react";
import type { Map as MLMap, GeoJSONSource, MapLayerMouseEvent } from "maplibre-gl";
import type { BarrierObservation, BBox } from "@/lib/ui/barrierTypes";
import type { LatLon } from "@/lib/ui/routeClient";
import { SOURCE_COLORS, SOURCE_GLYPHS } from "@/lib/ui/caveats";
import { STUDY_BBOX } from "@/lib/data/studyArea";
import { stairBlocks } from "@/lib/map/extrude";
import type { AccessCollection } from "@/lib/map/osmAccess";
import { toMapProps, SLOPE_BANDS, slopeBandLabel, type AccessFeatureV1 } from "@/lib/map/accessContract";
import { loadAccessData, loadOsmSnapshot } from "@/lib/map/accessStore";

/**
 * MapLibre map for downtown: flat by default, optional 3D tilt with extruded buildings
 * and stairways. OSM accessibility context (kerbs, crossings, steps, elevators) is
 * community-mapped and unverified — shown as context, never as barrier evidence.
 */

const STYLE_URL = "https://tiles.openfreemap.org/styles/positron";
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
  /** Pan request [lon, lat] (route steps / context items); seq changes on every request. */
  focus?: { at: [number, number]; seq: number } | null;
}

/** Context layer groups the user can toggle. Labels are shown in the legend (not color-only). */
const GROUPS = [
  { key: "buildings", label: "Buildings (3D)", layers: ["buildings-3d"] },
  { key: "paths", label: "Sidewalks & crossings", layers: ["acc-path-casing", "acc-sidewalk", "acc-crossing-casing", "acc-crossing-line", "acc-footway", "acc-crossing"] },
  { key: "kerbs", label: "Curb ramps / kerbs", layers: ["acc-kerb", "acc-kerb-label"] },
  { key: "steps", label: "Stairs", layers: ["acc-steps-casing", "acc-steps-line", "acc-steps-3d"] },
  { key: "ramps", label: "Ramps (R) and unconfirmed candidates (?)", layers: ["acc-ramp-casing", "acc-ramp", "acc-ramp-pt", "acc-ramp-pt-label"] },
  { key: "slope", label: "Slope (where known)", layers: ["acc-slope-casing", "acc-slope-measured", "acc-slope-estimated", "acc-slope-stairlike", "acc-slope-pt", "acc-slope-label"] },
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
    bLow: v("--map-b-low", "#f6ead8"),
    bMid: v("--map-b-mid", "#f2d3c2"),
    bHigh: v("--map-b-high", "#dccbe9"),
    bTower: v("--map-b-tower", "#bccbe8"),
    ramp: v("--map-ramp", "#a8458a"),
    slope: Object.fromEntries(SLOPE_BANDS.map((b) => [b.key, v(`--map-slope-${b.key.replace("_", "-")}`, "#64748b")])) as Record<string, string>,
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

/**
 * Map styles. Edit the tables below to restyle; no other code needs to change.
 *  - color:  pastel base + colorblind-safe overlays (default).
 *  - street: aerial-photo-like: asphalt roads, concrete sidewalks drawn at TRUE WIDTH,
 *            white zebra crosswalks on asphalt, green parks. Illustrative, not imagery:
 *            sidewalk width is a typical value, not measured.
 *  - plain:  the original grey base, for low distraction.
 * Overlays keep shape/dash/label cues in every style, so meaning never depends on color.
 */
export type MapStyle = "color" | "street" | "plain";
export const MAP_STYLES: { key: MapStyle; label: string }[] = [
  { key: "color", label: "Color" },
  { key: "street", label: "Street detail" },
  { key: "plain", label: "Plain" },
];

/** Base layer id -> [paint property, color] per style. "plain" restores the original style values. */
const BASE_PAINT: Record<string, { prop: string; color: string; street: string }> = {
  background: { prop: "background-color", color: "#f7f1e6", street: "#cdc7ba" },
  park: { prop: "fill-color", color: "#cfe8c4", street: "#8dbd76" },
  landcover_wood: { prop: "fill-color", color: "#bcdcae", street: "#6da35c" },
  landuse_residential: { prop: "fill-color", color: "#f4e9d8", street: "#c9c2b4" },
  water: { prop: "fill-color", color: "#a6d3ef", street: "#5fa6d1" },
  waterway: { prop: "line-color", color: "#86c1e6", street: "#5598c4" },
  road_area_pier: { prop: "fill-color", color: "#ead9bf", street: "#b4a892" },
  road_pier: { prop: "line-color", color: "#ead9bf", street: "#b4a892" },
  highway_path: { prop: "line-color", color: "#efe3cf", street: "#bab2a3" },
  highway_minor: { prop: "line-color", color: "#ffffff", street: "#5c6168" },
  highway_major_casing: { prop: "line-color", color: "#e2cba0", street: "#3d4248" },
  highway_major_inner: { prop: "line-color", color: "#fff4d1", street: "#575c63" },
  highway_motorway_casing: { prop: "line-color", color: "#dcb070", street: "#383c42" },
  highway_motorway_inner: { prop: "line-color", color: "#ffdf9e", street: "#53585f" },
  highway_motorway_bridge_casing: { prop: "line-color", color: "#dcb070", street: "#383c42" },
  highway_motorway_bridge_inner: { prop: "line-color", color: "#ffdf9e", street: "#53585f" },
  railway: { prop: "line-color", color: "#c4b8d8", street: "#857c72" },
  railway_transit: { prop: "line-color", color: "#c4b8d8", street: "#857c72" },
};

/**
 * Line width in pixels that matches `m` metres on the ground at this latitude
 * (512-px tiles: metres/pixel = 40075016.686 * cos(lat) / (512 * 2^zoom)).
 */
const MPP_Z0 = (40075016.686 * Math.cos((32.72 * Math.PI) / 180)) / 512;
export const metresWide = (m: number, minPx = 0.8) =>
  ["interpolate", ["exponential", 2], ["zoom"], 14, Math.max(minPx, (m * 2 ** 14) / MPP_Z0), 22, (m * 2 ** 22) / MPP_Z0] as any;
const zoomW = (a: number, b: number) => ["interpolate", ["linear"], ["zoom"], 15, a, 19, b] as any;

/** Typical downtown widths (metres) used by the street style. Illustrative only. */
const STREET_WIDTH = { sidewalk: 3, curbEdge: 3.6, footway: 2.2, crosswalk: 3, minorRoad: 11, majorRoad: 16 };

type OverlayPaint = Record<string, Record<string, unknown>>;
function overlayPaint(style: MapStyle, t: ReturnType<typeof tokens>): OverlayPaint {
  if (style === "street") {
    return {
      "acc-path-casing": { "line-color": "#8a8377", "line-width": metresWide(STREET_WIDTH.curbEdge) },
      "acc-sidewalk": { "line-color": "#ece7dc", "line-width": metresWide(STREET_WIDTH.sidewalk) },
      "acc-footway": { "line-color": "#e4ddcf", "line-width": metresWide(STREET_WIDTH.footway), "line-dasharray": [1, 0] },
      "acc-crossing-casing": { "line-color": "#5c6168", "line-width": metresWide(STREET_WIDTH.crosswalk + 0.6) },
      "acc-crossing-line": { "line-color": "#ffffff", "line-width": metresWide(STREET_WIDTH.crosswalk), "line-dasharray": [0.18, 0.18] },
      highway_minor: { "line-width": metresWide(STREET_WIDTH.minorRoad) },
      highway_major_inner: { "line-width": metresWide(STREET_WIDTH.majorRoad) },
      highway_major_casing: { "line-width": metresWide(STREET_WIDTH.majorRoad + 1) },
    };
  }
  return {
    "acc-path-casing": { "line-color": t.halo, "line-width": zoomW(2, 7) },
    "acc-sidewalk": { "line-color": t.sidewalk, "line-width": zoomW(1, 4.5) },
    "acc-footway": { "line-color": t.sidewalk, "line-width": zoomW(0.8, 3), "line-dasharray": [2, 1.5] },
    "acc-crossing-casing": { "line-color": t.crossing, "line-width": zoomW(2.5, 10) },
    "acc-crossing-line": { "line-color": t.halo, "line-width": zoomW(1.8, 8), "line-dasharray": [0.35, 0.35] },
    // Base road widths: restored from the original style (null = keep what was saved).
    highway_minor: { "line-width": null },
    highway_major_inner: { "line-width": null },
    highway_major_casing: { "line-width": null },
  };
}

/** Original base values, saved once at load so "plain"/"color" can restore them. */
type Orig = Record<string, Record<string, unknown>>;
function saveOrig(m: MLMap): Orig {
  const o: Orig = {};
  for (const [id, b] of Object.entries(BASE_PAINT)) if (m.getLayer(id)) o[id] = { [b.prop]: m.getPaintProperty(id, b.prop as any) };
  for (const id of ["highway_minor", "highway_major_inner", "highway_major_casing"]) if (m.getLayer(id)) (o[id] ??= {})["line-width"] = m.getPaintProperty(id, "line-width" as any);
  return o;
}

function applyStyle(m: MLMap, style: MapStyle, orig: Orig) {
  const t = tokens();
  for (const [id, b] of Object.entries(BASE_PAINT)) {
    if (!m.getLayer(id)) continue;
    const v = style === "plain" ? orig[id]?.[b.prop] : style === "street" ? b.street : b.color;
    if (v !== undefined) m.setPaintProperty(id, b.prop as any, v as any);
  }
  for (const [id, props] of Object.entries(overlayPaint(style, t))) {
    if (!m.getLayer(id)) continue;
    for (const [prop, v] of Object.entries(props)) {
      const val = v === null ? orig[id]?.[prop] : v;
      if (val !== undefined) m.setPaintProperty(id, prop as any, val as any);
    }
  }
  if (m.getLayer("buildings-3d")) {
    const h = ["coalesce", ["get", "render_height"], 0];
    const ramp = style === "color" ? [0, t.bLow, 25, t.bMid, 70, t.bHigh, 140, t.bTower]
      : style === "street" ? [0, "#d6cfc3", 30, "#bdb7ae", 90, "#a2a7ae", 160, "#8e98a3"] // roofs: concrete -> glass
      : [0, t.building, 60, t.buildingTop];
    m.setPaintProperty("buildings-3d", "fill-extrusion-color", ["interpolate", ["linear"], h, ...ramp] as any);
  }
  m.setLight(style === "plain"
    ? { anchor: "viewport", color: "#ffffff", intensity: 0.5, position: [1.15, 210, 30] }
    : { anchor: "viewport", color: "#fff1dc", intensity: style === "street" ? 0.55 : 0.45, position: [1.3, 210, 35] });
  // Sky/fog only shows when tilted.
  (m as any).setSky?.(style === "plain"
    ? { "sky-color": "#e2e8f0", "horizon-color": "#f1f5f9", "fog-color": "#f8fafc", "sky-horizon-blend": 0.6, "horizon-fog-blend": 0.7, "fog-ground-blend": 0.9 }
    : { "sky-color": "#8cc8ee", "horizon-color": "#fde3c6", "fog-color": style === "street" ? "#e6e1d6" : "#f7ecdd", "sky-horizon-blend": 0.6, "horizon-fog-blend": 0.7, "fog-ground-blend": 0.9 });
}

const STYLE_KEY = "accesspath.mapStyle";
const readStyle = (): MapStyle => {
  try { const v = localStorage.getItem(STYLE_KEY); return v === "street" || v === "plain" ? v : "color"; } catch { return "color"; }
};

const ACCESS_TEXT: Record<string, string> = {
  ramp: "Ramp / sloped path",
  ramp_candidate: "Possible ramp (unconfirmed)",
  curb_ramp: "Curb ramp",
  entrance: "Building entrance",
  slope_segment: "Path slope",
  other: "Accessibility detail",
  steps: "Stairs", sidewalk: "Sidewalk", crossing_line: "Crosswalk", footway: "Footpath", pedestrian_area: "Pedestrian street",
  kerb_lowered: "Lowered curb (curb ramp)", kerb_raised: "Raised curb (no ramp)", kerb_unknown: "Curb, type unknown",
  crossing: "Crossing point", elevator: "Elevator",
};

export default function MapView3D(p: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  const [ready, setReady] = useState(false);
  const [tilted, setTilted] = useState(false);
  const [shown, setShown] = useState<Record<GroupKey, boolean>>({ buildings: true, paths: true, kerbs: true, steps: true, ramps: true, slope: true, elevators: true });
  const [accessStatus, setAccessStatus] = useState<string>("Loading slope data…");
  const [style, setStyle] = useState<MapStyle>("color");
  useEffect(() => { setStyle(readStyle()); }, []);
  const origPaint = useRef<Orig>({});
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
        // Multisampled edges on 3D extrusions and stair blocks.
        antialias: true,
      } as any);
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
            "fill-extrusion-opacity": 0.92,
          },
        }, firstLabel);

        m.addSource("study", { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [[w, s], [e, s], [e, n], [w, n], [w, s]] } } });
        m.addLayer({ id: "study-outline", type: "line", source: "study", paint: { "line-color": t.ink, "line-width": 1.5, "line-dasharray": [4, 3], "line-opacity": 0.6 } });

        // Accessibility context via the shared store (accessStore.ts): every feature goes through
        // the contract (accessContract.ts), so OSM and Owner C data share one shape.
        const snap = await loadOsmSnapshot();
        if (snap.error) setAccessNote("Sidewalk/curb detail layer unavailable.");
        const toFC = (list: AccessFeatureV1[]) => ({ type: "FeatureCollection", features: list.map((f) => ({ type: "Feature", geometry: f.geometry, properties: toMapProps(f) })) });
        m.addSource("access", { type: "geojson", data: toFC(snap.norm) as any });
        const steps = (snap.raw as any[]).filter((f) => f.properties.kind === "steps" && f.geometry.type === "LineString");
        m.addSource("steps3d", { type: "geojson", data: { type: "FeatureCollection", features: steps.flatMap((f) => stairBlocks(f.geometry.coordinates, f.properties.osm_id, f.properties.step_count)) } });

        const kind = (k: string | string[]) => (Array.isArray(k) ? ["in", ["get", "kind"], ["literal", k]] : ["==", ["get", "kind"], k]) as any;

        const round = { "line-cap": "round", "line-join": "round" } as any;
        // White casings under line overlays: crisp edges on any base or building color.
        m.addLayer({ id: "acc-path-casing", type: "line", source: "access", filter: kind(["footway", "pedestrian_area", "sidewalk"]), layout: round, paint: { "line-color": t.halo, "line-width": zoomW(2, 7) } });
        m.addLayer({ id: "acc-footway", type: "line", source: "access", filter: kind(["footway", "pedestrian_area"]), paint: { "line-color": t.sidewalk, "line-width": zoomW(0.8, 3), "line-dasharray": [2, 1.5] } });
        m.addLayer({ id: "acc-sidewalk", type: "line", source: "access", filter: kind("sidewalk"), layout: round, paint: { "line-color": t.sidewalk, "line-width": zoomW(1, 4.5) } });
        // Crosswalks as zebra stripes: dark band with white dashes.
        m.addLayer({ id: "acc-crossing-casing", type: "line", source: "access", filter: kind("crossing_line"), paint: { "line-color": t.crossing, "line-width": zoomW(2.5, 10) } });
        m.addLayer({ id: "acc-crossing-line", type: "line", source: "access", filter: kind("crossing_line"), paint: { "line-color": t.halo, "line-width": zoomW(1.8, 8), "line-dasharray": [0.35, 0.35] } });
        m.addLayer({ id: "acc-ramp-casing", type: "line", source: "access", filter: kind("ramp"), layout: round, paint: { "line-color": t.halo, "line-width": zoomW(3, 10) } });
        m.addLayer({ id: "acc-ramp", type: "line", source: "access", filter: kind("ramp"), layout: round, paint: { "line-color": t.ramp, "line-width": zoomW(1.5, 6), "line-dasharray": [2.5, 0.8] } });
        m.addLayer({ id: "acc-steps-casing", type: "line", source: "access", filter: kind("steps"), layout: round, paint: { "line-color": t.halo, "line-width": zoomW(3.5, 10) } });
        m.addLayer({ id: "acc-steps-line", type: "line", source: "access", filter: kind("steps"), paint: { "line-color": t.steps, "line-width": zoomW(2, 7), "line-dasharray": [0.6, 0.25] } });
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

        // Ramp points. Filled + "R" = mapped/reported ramp; hollow ring + "?" = unconfirmed candidate.
        const rampPts = ["all", ["==", ["geometry-type"], "Point"], kind(["curb_ramp", "entrance", "ramp_candidate", "ramp"])] as any;
        const isCandidate = ["any", ["==", ["get", "kind"], "ramp_candidate"], ["==", ["get", "method"], "inferred"], ["==", ["get", "method"], "ai_estimate"]] as any;
        m.addLayer({
          id: "acc-ramp-pt", type: "circle", source: "access", filter: rampPts, minzoom: 15.5,
          paint: { "circle-radius": zoomW(3, 8), "circle-color": ["case", isCandidate, t.halo, t.ramp], "circle-stroke-color": t.ramp, "circle-stroke-width": ["case", isCandidate, 2, 1] },
        });
        m.addLayer({
          id: "acc-ramp-pt-label", type: "symbol", source: "access", filter: rampPts, minzoom: 17,
          layout: { "text-field": ["case", isCandidate, "?", "R"], "text-font": FONT, "text-size": 10, "text-allow-overlap": true },
          paint: { "text-color": ["case", isCandidate, t.ramp, t.halo] },
        });

        // Slope: color = band (sequential, light->dark = gentle->steep); solid = measured/official, dashed = estimate/tag.
        const slopeColor = ["match", ["get", "slope_band"], ...SLOPE_BANDS.flatMap((b) => [b.key, t.slope[b.key]]), t.kerbUnknown] as any;
        const slopeLine = ["all", ["==", ["geometry-type"], "LineString"], ["!=", ["get", "slope_band"], "unknown"]] as any;
        m.addLayer({ id: "acc-slope-casing", type: "line", source: "access", filter: slopeLine, layout: round, paint: { "line-color": t.halo, "line-width": zoomW(4, 12) } });
        m.addLayer({ id: "acc-slope-measured", type: "line", source: "access", filter: ["all", slopeLine, ["==", ["get", "estimated"], 0]], layout: round, paint: { "line-color": slopeColor, "line-width": zoomW(2, 7) } });
        m.addLayer({ id: "acc-slope-estimated", type: "line", source: "access", filter: ["all", slopeLine, ["==", ["get", "estimated"], 1]], paint: { "line-color": slopeColor, "line-width": zoomW(2, 7), "line-dasharray": [1.6, 0.8] } });
        // Very steep ground (>12%) not tagged as stairs: drawn with the STAIR pattern (red, short dashes),
        // because it may be unmapped stairs. Popup and route panel say "possibly", never "is".
        m.addLayer({
          id: "acc-slope-stairlike", type: "line", source: "access",
          filter: ["all", slopeLine, ["==", ["get", "slope_band"], "very_steep"], ["!=", ["get", "kind"], "steps"]],
          paint: { "line-color": t.slope.very_steep, "line-width": zoomW(3, 9), "line-dasharray": [0.6, 0.25] },
        });
        m.addLayer({
          id: "acc-slope-pt", type: "circle", source: "access", filter: ["all", ["==", ["geometry-type"], "Point"], ["!=", ["get", "slope_band"], "unknown"]], minzoom: 15.5,
          paint: { "circle-radius": zoomW(3, 9), "circle-color": t.halo, "circle-stroke-color": slopeColor, "circle-stroke-width": 3 },
        });
        // Number cue so slope never relies on color alone ("~" = not measured).
        m.addLayer({
          id: "acc-slope-label", type: "symbol", source: "access", filter: ["!=", ["get", "slope_band"], "unknown"], minzoom: 17,
          layout: { "text-field": ["get", "slope_label"], "text-font": FONT, "text-size": 11, "symbol-placement": "point", "text-offset": [0, -1.2], "text-allow-overlap": false },
          paint: { "text-color": t.ink, "text-halo-color": t.halo, "text-halo-width": 2 },
        });

        // Owner C feed (optional). API features replace OSM features with the same id, else are added.
        loadAccessData().then(({ api: res, merged, derivedSlopes }) => {
          if (cancelled) return;
          const dem = derivedSlopes ? `Slope estimates: ${derivedSlopes} path segments from USGS lidar elevation (estimates, not measured)` : "Slope data: OpenStreetMap incline tags only";
          if (!res.ok) {
            setAccessStatus(`${dem}. ${res.code === "NOT_DEPLOYED" ? "Detailed access feed not connected yet." : `Detailed access feed unavailable (${res.message}).`}`);
            return;
          }
          (m.getSource("access") as GeoJSONSource | undefined)?.setData(toFC(merged) as any);
          const est = res.features.filter((f) => f.properties.provenance.method === "ai_estimate" || f.properties.provenance.method === "inferred").length;
          setAccessStatus([dem, `Detailed access feed: ${res.features.length} features (${est} estimated)`, res.sourceNote, res.dropped ? `${res.dropped} unreadable rows skipped` : null, res.versionWarning].filter(Boolean).join(". ") + ".");
        });

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

        origPaint.current = saveOrig(m);
        applyStyle(m, readStyle(), origPaint.current);

        // Interactions.
        const clickable = ["barrier-points", "barrier-lines"];
        const ctx = ["acc-steps-line", "acc-ramp", "acc-ramp-pt", "acc-slope-measured", "acc-slope-estimated", "acc-slope-stairlike", "acc-slope-pt", "acc-kerb", "acc-crossing", "acc-elevator"];
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

  useEffect(() => {
    if (ready && map.current) applyStyle(map.current, style, origPaint.current);
    try { localStorage.setItem(STYLE_KEY, style); } catch { /* per-viewer convenience only */ }
  }, [style, ready]);

  useEffect(() => {
    const m = map.current;
    if (!ready || !m || !p.focus) return;
    m.easeTo({ center: p.focus.at, zoom: Math.max(m.getZoom(), 18.5), duration: 600 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.focus?.seq, ready]);

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
        <div className="style-switch" role="radiogroup" aria-label="Map style">
          {MAP_STYLES.map((o) => (
            <button key={o.key} type="button" role="radio" aria-checked={style === o.key} onClick={() => setStyle(o.key)}>{o.label}</button>
          ))}
        </div>
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
            Curb ramps: ▼ lowered · ▲ raised · ? unknown. Crosswalks: zebra stripes. Stairs: dashed orange. Street detail: sidewalks drawn as concrete at a typical (not measured) width, crosswalks as white stripes. Ramps: magenta; R = mapped, ? = unconfirmed candidate. Slope colors: green = gentle, amber = moderate, red = steep; red short dashes = very steep, possibly unmapped stairs; solid = measured, dashed = estimate; "~6%" = not measured. A slope value is never proof a route is accessible. Sidewalk, curb and stair detail is community-mapped (OpenStreetMap), may be incomplete, and is not verified. Missing detail means unknown.
          </p>
          <ul className="slope-legend" aria-label="Slope bands">
            {SLOPE_BANDS.map((b) => (
              <li key={b.key}><span className={`swatch swatch--slope-${b.key.replace("_", "-")}`} aria-hidden="true" /> {b.label}</li>
            ))}
          </ul>
          <p className="small muted" role="status">{accessStatus}</p>
          {accessNote && <p className="small error">{accessNote}</p>}
        </details>
      </div>
    </div>
  );
}

const YES_NO_FIELDS: [string, string][] = [["handrail", "Handrail"], ["landing", "Landing"], ["tactile_paving", "Tactile paving"], ["signals", "Signals"], ["wheelchair", "Wheelchair tag"]];
const METHOD_TEXT: Record<string, string> = {
  measured: "measured", official_dataset: "official dataset", community_tag: "community tag (OpenStreetMap)",
  ai_estimate: "AI estimate", inferred: "inferred from nearby data", unknown: "unknown",
};

/**
 * Popup content built with DOM APIs (textContent), never innerHTML from data.
 * Reads the flattened contract props (toMapProps), so new sources need no popup change.
 * Missing values are omitted, except slope, which is shown as "unknown".
 */
function accessPopup(pr: Record<string, any>): HTMLElement {
  const root = document.createElement("div");
  root.className = "access-popup";
  const h = document.createElement("strong");
  h.textContent = ACCESS_TEXT[pr.kind] ?? "Pedestrian feature";
  root.appendChild(h);
  const has = (v: unknown) => v !== null && v !== undefined && v !== "" && v !== "null";
  const rows: [string, string][] = [];
  if (has(pr.ramp_type) && pr.ramp_type !== "unknown") rows.push(["Ramp type", String(pr.ramp_type).replace("_", " ")]);
  if (pr.kind !== "crossing" && pr.kind !== "elevator") {
    rows.push(["Slope", has(pr.slope_pct) ? `${pr.slope_label} (${slopeBandLabel(pr.slope_band)})` : has(pr.incline_raw) ? `${pr.incline_raw} (no number)` : "unknown"]);
  }
  if (has(pr.cross_slope_pct)) rows.push(["Cross slope", `${pr.estimated ? "~" : ""}${Math.round(Number(pr.cross_slope_pct) * 10) / 10}%`]);
  if (has(pr.width_m)) rows.push(["Width", `${Math.round(Number(pr.width_m) * 100) / 100} m`]);
  if (has(pr.rise_m)) rows.push(["Height change", `~${pr.rise_m} m (estimate from elevation data)`]);
  if (has(pr.kerb_height_cm)) rows.push(["Curb height", `${pr.kerb_height_cm} cm`]);
  if (pr.kind === "steps") rows.push(["Steps", has(pr.step_count) ? String(pr.step_count) : "count unknown"]);
  if (has(pr.surface)) rows.push(["Surface", String(pr.surface)]);
  if (has(pr.surface_condition) && pr.surface_condition !== "unknown") rows.push(["Condition", String(pr.surface_condition)]);
  for (const [k, label] of YES_NO_FIELDS) if (has(pr[k]) && pr[k] !== "unknown") rows.push([label, String(pr[k])]);
  rows.push(["Source", String(pr.source ?? "unknown")], ["Source date", has(pr.source_date) ? String(pr.source_date).slice(0, 10) : "unknown"]);
  rows.push(["Method", METHOD_TEXT[pr.method] ?? "unknown"], ["Status", String(pr.verification_status ?? "unknown").replace("_", " ")]);
  if (has(pr.confidence) && pr.confidence !== "unknown") rows.push(["Confidence", String(pr.confidence)]);
  const dl = document.createElement("dl");
  for (const [k, v] of rows) {
    const dt = document.createElement("dt"); dt.textContent = k;
    const dd = document.createElement("dd"); dd.textContent = v;
    dl.append(dt, dd);
  }
  root.appendChild(dl);
  const note = document.createElement("p");
  note.textContent = [has(pr.note) ? String(pr.note) : null, "Unverified context. Not proof of accessibility or ADA compliance."].filter(Boolean).join(" ");
  root.appendChild(note);
  if (has(pr.source_url) && /^https:\/\//.test(String(pr.source_url))) {
    const link = document.createElement("a");
    link.href = String(pr.source_url); link.target = "_blank"; link.rel = "noopener noreferrer";
    link.textContent = "View source";
    root.appendChild(link);
  }
  return root;
}
