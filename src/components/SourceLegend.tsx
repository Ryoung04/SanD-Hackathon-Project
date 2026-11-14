import type { SourceKind } from "@/lib/ui/barrierTypes";
import { SOURCE_COLORS, SOURCE_GLYPHS, SOURCE_LABELS } from "@/lib/ui/caveats";

export const ALL_SOURCES = Object.keys(SOURCE_LABELS) as SourceKind[];

/** Legend + layer toggles in one control (LayerControls). Glyph + text, never color alone. */
export default function SourceLegend({
  enabled,
  onToggle,
  counts,
}: {
  enabled: ReadonlySet<SourceKind>;
  onToggle: (k: SourceKind) => void;
  counts: Partial<Record<SourceKind, number>>;
}) {
  return (
    <fieldset className="panel legend">
      <legend>Sources shown</legend>
      <ul>
        {ALL_SOURCES.map((k) => (
          <li key={k}>
            <label>
              <input type="checkbox" checked={enabled.has(k)} onChange={() => onToggle(k)} />
              <span className="marker marker--small" style={{ background: SOURCE_COLORS[k] }} aria-hidden="true">
                {SOURCE_GLYPHS[k]}
              </span>
              {SOURCE_LABELS[k]} <span className="muted">({counts[k] ?? 0})</span>
            </label>
          </li>
        ))}
      </ul>
      <p className="muted small">
        Markers show <strong>potential</strong> barriers from records. No marker does not mean accessible — coverage is incomplete.
      </p>
    </fieldset>
  );
}
