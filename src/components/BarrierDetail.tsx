"use client";

import type { BarrierObservation } from "@/lib/ui/barrierTypes";
import {
  SOURCE_GLYPHS,
  SOURCE_LABELS,
  VERIFICATION_LABELS,
  caveatFor,
  dateOrUnknown,
  humanize,
  observedDateText,
} from "@/lib/ui/caveats";
import EvidenceActions from "./EvidenceActions";
import { investigateTarget } from "@/lib/ui/evidenceClient";

function safeHttpUrl(u: string | null): string | null {
  if (!u) return null;
  try {
    const p = new URL(u);
    return p.protocol === "https:" || p.protocol === "http:" ? p.href : null;
  } catch {
    return null;
  }
}

export default function BarrierDetail({ obs, onClose }: { obs: BarrierObservation | null; onClose: () => void }) {
  if (!obs) {
    return (
      <section className="panel" aria-labelledby="detail-h">
        <h2 id="detail-h">Selected observation</h2>
        <p className="muted">Select a marker on the map or an item in the list to see its source and uncertainty.</p>
      </section>
    );
  }
  const isFixture = obs.metadata?.fixture === true || obs.id.startsWith("fixture:");
  const url = safeHttpUrl(obs.source_url);
  return (
    <section className="panel" aria-labelledby="detail-h" aria-live="polite">
      <div className="panel-head">
        <h2 id="detail-h">{obs.label}</h2>
        <button type="button" onClick={onClose} aria-label="Close observation detail">Close</button>
      </div>
      {isFixture && <p className="badge badge--fixture">Demo fixture — not a real record</p>}
      <p className="caveat">{caveatFor(obs)}</p>
      <dl className="facts">
        <dt>Category</dt><dd>{humanize(obs.category)}</dd>
        <dt>Source</dt><dd><span className="glyph" aria-hidden="true">{SOURCE_GLYPHS[obs.source_kind]}</span> {SOURCE_LABELS[obs.source_kind]}</dd>
        <dt>Original record</dt>
        <dd>{url ? <a href={url} target="_blank" rel="noopener noreferrer">Open source record (new tab)</a> : obs.source_url?.startsWith("upload:") ? "Participant upload (no public link)" : "Source link not available"}</dd>
        <dt>Observed</dt><dd>{observedDateText(obs.source_observed_at)}</dd>
        <dt>Source last updated</dt><dd>{dateOrUnknown(obs.source_updated_at)}</dd>
        <dt>Ingested</dt><dd>{dateOrUnknown(obs.ingested_at)}</dd>
        <dt>Verification</dt><dd>{VERIFICATION_LABELS[obs.verification_status]}</dd>
        <dt>Location precision</dt><dd>{humanize(obs.geometry_precision)}</dd>
        <dt>Routing impact</dt><dd>{obs.routing_impact === "unknown" ? "Unknown" : humanize(obs.routing_impact)}</dd>
        <dt>Severity</dt><dd>{humanize(obs.severity)}</dd>
      </dl>
      {obs.description && (
        <>
          <h3>Description (from source, unverified text)</h3>
          <p className="desc">{obs.description}</p>
        </>
      )}
      {!isFixture && <EvidenceActions target={investigateTarget(obs)} onScreenText={`${obs.label}. ${caveatFor(obs)}`} />}
    </section>
  );
}
