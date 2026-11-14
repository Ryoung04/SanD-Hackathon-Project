"use client";

import type { BarrierObservation } from "@/lib/ui/barrierTypes";
import { SOURCE_GLYPHS, SOURCE_LABELS, observedDateText } from "@/lib/ui/caveats";

/** Keyboard/screen-reader equivalent of the map markers. */
export default function ObservationList({
  items,
  selectedId,
  onSelect,
}: {
  items: BarrierObservation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <section className="panel" aria-labelledby="list-h">
      <h2 id="list-h">Observations in view ({items.length})</h2>
      {items.length === 0 ? (
        <p className="muted">No records in this area for the selected sources. This does not mean the area is accessible.</p>
      ) : (
        <ul className="obs-list">
          {items.map((o) => (
            <li key={o.id}>
              <button type="button" aria-pressed={o.id === selectedId} onClick={() => onSelect(o.id)}>
                <span className="glyph" aria-hidden="true">{SOURCE_GLYPHS[o.source_kind]}</span>
                <span>
                  {o.label}
                  <span className="muted small"> · {SOURCE_LABELS[o.source_kind]} · {observedDateText(o.source_observed_at)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
