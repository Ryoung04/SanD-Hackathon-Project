"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BarrierObservation, BBox, DataMode, SourceKind } from "@/lib/ui/barrierTypes";
import { debounce, filterBySource, loadBarriers } from "@/lib/ui/barrierClient";
import BarrierDetail from "@/components/BarrierDetail";
import ObservationList from "@/components/ObservationList";
import SourceLegend, { ALL_SOURCES } from "@/components/SourceLegend";

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

  const fetchBBox = useCallback(async (bbox: BBox) => {
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
          <MapView observations={visible} selectedId={selectedId} onSelect={setSelectedId} onBoundsChange={onBoundsChange} />
          {loading && <span className="loading-pill" aria-live="polite">Loading records…</span>}
        </div>
        <aside className="side">
          {/* Sprint 2: <RoutePlanner /> goes here (POST /api/route). */}
          <BarrierDetail obs={selected} onClose={() => setSelectedId(null)} />
          <SourceLegend enabled={enabled} onToggle={toggle} counts={counts} />
          <ObservationList items={visible} selectedId={selectedId} onSelect={setSelectedId} />
        </aside>
      </main>
    </div>
  );
}
