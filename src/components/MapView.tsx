"use client";

import { useEffect, useRef } from "react";
import type { Map as LMap, LayerGroup } from "leaflet";
import type { BarrierObservation, BBox } from "@/lib/ui/barrierTypes";
import { SOURCE_COLORS, SOURCE_GLYPHS, SOURCE_LABELS } from "@/lib/ui/caveats";
import { DEFAULT_CENTER } from "@/lib/ui/fixtures";

interface Props {
  observations: BarrierObservation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onBoundsChange: (bbox: BBox) => void;
}

/** Leaflet map. Loaded client-only; all observation text is set via textContent / aria, never innerHTML from data. */
export default function MapView({ observations, selectedId, onSelect, onBoundsChange }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<LMap | null>(null);
  const layer = useRef<LayerGroup | null>(null);
  const L = useRef<typeof import("leaflet") | null>(null);
  const cbs = useRef({ onSelect, onBoundsChange });
  cbs.current = { onSelect, onBoundsChange };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const leaflet = await import("leaflet");
      if (cancelled || !el.current || map.current) return;
      L.current = leaflet;
      const m = leaflet.map(el.current, { center: DEFAULT_CENTER, zoom: 16, keyboard: true });
      leaflet
        .tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        })
        .addTo(m);
      layer.current = leaflet.layerGroup().addTo(m);
      const emit = () => {
        const b = m.getBounds();
        cbs.current.onBoundsChange([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
      };
      m.on("moveend", emit);
      map.current = m;
      emit();
    })();
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const leaflet = L.current;
    const group = layer.current;
    if (!leaflet || !group) return;
    group.clearLayers();
    for (const o of observations) {
      const color = SOURCE_COLORS[o.source_kind];
      const selected = o.id === selectedId;
      const title = `${o.label} — ${SOURCE_LABELS[o.source_kind]}`;
      if (o.geometry.type === "Point") {
        const [lon, lat] = o.geometry.coordinates;
        const icon = leaflet.divIcon({
          className: "",
          html: `<span class="marker${selected ? " marker--selected" : ""}" style="background:${color}"></span>`,
          iconSize: [32, 32],
          iconAnchor: [16, 16],
        });
        const mk = leaflet.marker([lat, lon], { icon, title, alt: title, keyboard: true }).addTo(group);
        const span = mk.getElement()?.querySelector(".marker");
        if (span) span.textContent = SOURCE_GLYPHS[o.source_kind];
        mk.on("click", () => cbs.current.onSelect(o.id));
      } else {
        const lines = o.geometry.type === "LineString" ? [o.geometry.coordinates] : o.geometry.coordinates;
        for (const line of lines) {
          leaflet
            .polyline(
              line.map(([lon, lat]) => [lat, lon] as [number, number]),
              { color, weight: selected ? 9 : 5, opacity: 0.9, dashArray: selected ? undefined : "6 4" },
            )
            .addTo(group)
            .on("click", () => cbs.current.onSelect(o.id))
            .bindTooltip(title);
        }
      }
    }
  }, [observations, selectedId]);

  // Pan to selection made from the list.
  useEffect(() => {
    const m = map.current;
    const o = observations.find((x) => x.id === selectedId);
    if (!m || !o) return;
    const pt =
      o.geometry.type === "Point"
        ? o.geometry.coordinates
        : o.geometry.type === "LineString"
          ? o.geometry.coordinates[0]
          : o.geometry.coordinates[0]?.[0];
    if (pt && !m.getBounds().contains([pt[1], pt[0]])) m.panTo([pt[1], pt[0]]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  return <div ref={el} className="map" role="region" aria-label="Map of potential accessibility barriers" />;
}
