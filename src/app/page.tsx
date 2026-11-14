"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BarrierObservation, BBox, DataMode, SourceKind } from "@/lib/ui/barrierTypes";
import { clearBarrierCache, debounce, filterBySource, loadBarriers } from "@/lib/ui/barrierClient";
import BarrierDetail from "@/components/BarrierDetail";
import ObservationList from "@/components/ObservationList";
import SourceLegend, { ALL_SOURCES } from "@/components/SourceLegend";
import RoutePlanner, { type PickTarget } from "@/components/RoutePlanner";
import NoticesPanel from "@/components/NoticesPanel";
import PhotoReport from "@/components/PhotoReport";
import { STUDY_BBOX } from "@/lib/data/studyArea";
import { inBBox, requestRoute, type LatLon, type RouteProfile, type RouteResult } from "@/lib/ui/routeClient";

const MapView = dynamic(() => import("@/components/MapView"), {
  ssr: false,
  loading: () => <div className="map map--loading">Loading map…</div>,
});

export default function Home() {
  const [all, setAll] = useState<BarrierObservation[]>([]);
  const [mode, setMode] = useState<DataMode | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [enabled, setEnabled] = useState<Set<SourceKind>>(() => new Set(ALL_SOURCES));
  const reqSeq = useRef(0);
  const [start, setStart] = useState<LatLon | null>(null);
  const [end, setEnd] = useState<LatLon | null>(null);
  const [picking, setPicking] = useState<PickTarget>(null);
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [routing, setRouting] = useState(false);
  const routeSeq = useRef(0);

  const onPick = (p: LatLon) => {
    if (!inBBox(p, STUDY_BBOX)) return; // click in the margin outside the study area: ignore, stay in pick mode
    if (picking === "start") setStart(p); else if (picking === "end") setEnd(p);
    setPicking(null);
  };
  const submitRoute = async (profile: RouteProfile) => {
    if (!start || !end) return;
    const seq = ++routeSeq.current;
    setRouting(true);
    const r = await requestRoute(start, end, profile);
    if (seq !== routeSeq.current) return;
    setRoute(r);
    setRouting(false);
  };
  // After a saved photo report, drop cached tiles and refetch the current view.
  const refreshBarriers = () => { clearBarrierCache(); if (lastBBox.current) fetchBBox(lastBBox.current); };
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
  const counts = useMemo(() => {
    const c: Partial<Record<SourceKind, number>> = {};
    for (const o of all) c[o.source_kind] = (c[o.source_kind] ?? 0) + 1;
    return c;
  }, [all]);
  const selected = visible.find((o) => o.id === selectedId) ?? null;

  const toggle = (k: SourceKind) =>
    setEnabled((prev) => {
      const next = new Set(prev);
      next.has(k) ? next.delete(k) : next.add(k);
      return next;
    });

  return (
    <div className="app">
      <header className="topbar">
        <h1>AccessPath SD</h1>
        <p className="tagline">Potential sidewalk barriers from public records — not a guarantee of accessibility.</p>
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
          />
          {loading && <span className="loading-pill" aria-live="polite">Loading records…</span>}
        </div>
        <aside className="side">
          <RoutePlanner
            start={start} end={end} onStart={setStart} onEnd={setEnd} picking={picking} onPick={setPicking}
            result={route} loading={routing} onSubmit={submitRoute} onClear={clearRoute}
            observations={all} onSelect={setSelectedId}
          />
          <BarrierDetail obs={selected} onClose={() => setSelectedId(null)} />
          <NoticesPanel onSelect={setSelectedId} />
          <PhotoReport suggestedLocation={start} onSaved={refreshBarriers} />
          <SourceLegend enabled={enabled} onToggle={toggle} counts={counts} />
          <ObservationList items={visible} selectedId={selectedId} onSelect={setSelectedId} />
        </aside>
      </main>
    </div>
  );
}
