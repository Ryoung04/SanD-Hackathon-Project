"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BarrierObservation, BBox, DataMode, SourceKind } from "@/lib/ui/barrierTypes";
import { clearBarrierCache, debounce, filterBySource, loadBarriers } from "@/lib/ui/barrierClient";
import BarrierDetail from "@/components/BarrierDetail";
import ObservationList from "@/components/ObservationList";
import SourceLegend, { ALL_SOURCES } from "@/components/SourceLegend";
import RoutePlanner, { type PickTarget, type SampleTrip } from "@/components/RoutePlanner";
import { loadAccessData } from "@/lib/map/accessStore";
import { routeContext, type ContextGroup } from "@/lib/map/routeContext";
import NoticesPanel from "@/components/NoticesPanel";
import PhotoReport from "@/components/PhotoReport";
import SourcesPanel from "@/components/SourcesPanel";
import { STUDY_BBOX } from "@/lib/data/studyArea";
import { inBBox, loadRouteObservations, requestRoute, type LatLon, type RouteProfile, type RouteResult } from "@/lib/ui/routeClient";

const mapLoading = () => <div className="map map--loading">Loading map…</div>;
const MapView2D = dynamic(() => import("@/components/MapView"), { ssr: false, loading: mapLoading });
// Default: MapLibre (flat + optional 3D). Fallback: Leaflet 2D via ?map=2d.
const MapView3D = dynamic(() => import("@/components/MapView3D"), { ssr: false, loading: mapLoading });

export default function Home() {
  const [all, setAll] = useState<BarrierObservation[]>([]);
  const [mode, setMode] = useState<DataMode | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [enabled, setEnabled] = useState<Set<SourceKind>>(() => new Set(ALL_SOURCES));
  const reqSeq = useRef(0);
  const [use2d, setUse2d] = useState(false);
  useEffect(() => { setUse2d(new URLSearchParams(window.location.search).get("map") === "2d"); }, []);
  const MapView = use2d ? MapView2D : MapView3D;
  const [start, setStart] = useState<LatLon | null>(null);
  const [end, setEnd] = useState<LatLon | null>(null);
  const [picking, setPicking] = useState<PickTarget>(null);
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [routing, setRouting] = useState(false);
  const routeSeq = useRef(0);
  const [context, setContext] = useState<ContextGroup[] | null>(null);
  const [contextError, setContextError] = useState<string | null>(null);
  /** Map pan request; seq makes repeated clicks on the same point still pan. */
  const [focus, setFocus] = useState<{ at: [number, number]; seq: number } | null>(null);
  const onFocus = (at: [number, number]) => setFocus((f) => ({ at, seq: (f?.seq ?? 0) + 1 }));

  const onPick = (p: LatLon) => {
    if (!inBBox(p, STUDY_BBOX)) return; // click in the margin outside the study area: ignore, stay in pick mode
    if (picking === "start") setStart(p); else if (picking === "end") setEnd(p);
    setPicking(null);
  };
  const submitRoute = async (profile: RouteProfile, from: LatLon | null = start, to: LatLon | null = end) => {
    if (!from || !to) return;
    const seq = ++routeSeq.current;
    setRouting(true);
    const r = await requestRoute(from, to, profile);
    if (seq !== routeSeq.current) return;
    setRoute(r);
    setRouting(false);
  };
  // After a saved photo report, drop cached tiles and refetch the current view.
  const refreshBarriers = () => { clearBarrierCache(); if (lastBBox.current) fetchBBox(lastBBox.current); };
  const runSample = (profile: RouteProfile, trip: SampleTrip) => {
    setStart(trip.start); setEnd(trip.end); setPicking(null);
    submitRoute(profile, trip.start, trip.end);
  };

  // Map context (stairs, curbs, slopes...) near the current route, from the shared access store.
  useEffect(() => {
    setContext(null); setContextError(null);
    if (route?.status !== "route_available") return;
    let live = true;
    loadAccessData().then((d) => {
      if (!live) return;
      if (d.snapshotError && !d.merged.length) { setContextError(d.snapshotError); return; }
      setContext(routeContext(route.route.coordinates, d.merged));
    });
    return () => { live = false; };
  }, [route]);

  // Near-route records outside the loaded map view: fetch them so each warning shows its source.
  const [routeObs, setRouteObs] = useState<BarrierObservation[]>([]);
  useEffect(() => {
    setRouteObs([]);
    if (route?.status !== "route_available") return;
    const ids = (route.nearby_details ?? []).map((d) => d.id);
    let live = true;
    loadRouteObservations(route.route.coordinates, ids).then((obs) => { if (live) setRouteObs(obs); });
    return () => { live = false; };
  }, [route]);

  const clearRoute = () => { routeSeq.current++; setStart(null); setEnd(null); setRoute(null); setRouting(false); setPicking(null); };

  const lastBBox = useRef<BBox | null>(null);
  const fetchBBox = useCallback(async (bbox: BBox) => {
    lastBBox.current = bbox;
    const seq = ++reqSeq.current;
    setLoading(true);
    const { response, liveError } = await loadBarriers(bbox);
    if (seq !== reqSeq.current) return; // stale
    setAll(response.data);
    setMode(response.meta.data_mode);
    setLiveError(liveError);
    setLoading(false);
  }, []);

  const onBoundsChange = useMemo(() => debounce(fetchBBox, 350), [fetchBBox]);
  useEffect(() => () => onBoundsChange.cancel(), [onBoundsChange]);

  const visible = useMemo(() => filterBySource(all, enabled), [all, enabled]);
  const withRoute = useMemo(() => {
    if (!routeObs.length) return all;
    const have = new Set(all.map((o) => o.id));
    return [...all, ...routeObs.filter((o) => !have.has(o.id))];
  }, [all, routeObs]);
  const counts = useMemo(() => {
    const c: Partial<Record<SourceKind, number>> = {};
    for (const o of all) c[o.source_kind] = (c[o.source_kind] ?? 0) + 1;
    return c;
  }, [all]);
  const selected = filterBySource(withRoute, enabled).find((o) => o.id === selectedId) ?? null;

  const toggle = (k: SourceKind) =>
    setEnabled((prev) => {
      const next = new Set(prev);
      next.has(k) ? next.delete(k) : next.add(k);
      return next;
    });

  return (
    <div className="app">
      <header className="topbar">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/beacon.svg" alt="" className="brand-logo" />
        <div>
          <h1>Beacon<span className="brand-sub">San Diego</span></h1>
          <p className="tagline">Potential sidewalk barriers from public records — not a guarantee of accessibility.</p>
        </div>
      </header>

      {mode === "demo_fixture" && (
        <div className="banner banner--fixture" role="alert">
          <strong>Demo fixture data.</strong> Live barrier data is unavailable
          {liveError ? ` (${liveError})` : ""}. Markers shown are placeholders, not real records.
        </div>
      )}
      <p className="banner banner--coverage">Coverage incomplete: records exist only where sources have reported; unmarked areas are unknown, not accessible.</p>

      <main className="layout">
        <div className="map-wrap">
          <MapView
            observations={visible} selectedId={selectedId} onSelect={setSelectedId} onBoundsChange={onBoundsChange}
            route={route?.status === "route_available" ? route.route.coordinates : null}
            start={start} end={end} picking={picking !== null} onPick={onPick}
            focus={focus}
          />
          {loading && <span className="loading-pill" aria-live="polite">Loading records…</span>}
        </div>
        <aside className="side">
          <RoutePlanner
            start={start} end={end} onStart={setStart} onEnd={setEnd} picking={picking} onPick={setPicking}
            result={route} loading={routing} onSubmit={submitRoute} onClear={clearRoute}
            observations={withRoute} onSelect={setSelectedId}
            onSample={runSample} context={context} contextError={contextError} onFocus={onFocus}
          />
          <BarrierDetail obs={selected} onClose={() => setSelectedId(null)} />
          <NoticesPanel onSelect={setSelectedId} />
          <PhotoReport suggestedLocation={start} onSaved={refreshBarriers} />
          <SourcesPanel />
          <SourceLegend enabled={enabled} onToggle={toggle} counts={counts} />
          <ObservationList items={visible} selectedId={selectedId} onSelect={setSelectedId} />
        </aside>
      </main>
    </div>
  );
}
