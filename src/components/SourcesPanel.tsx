"use client";

import { useState } from "react";
import { fetchSources, type SourcesFetchResult } from "@/lib/ui/evidenceClient";

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "unknown");

/**
 * "Where this data comes from": Owner A's GET /api/sources (data trust summary).
 * Loads on first open. For each source it states what the source proves and what it
 * does NOT prove, so a record is never read as more certain than its source allows.
 * Hidden if the endpoint isn't deployed.
 */
export default function SourcesPanel() {
  const [res, setRes] = useState<SourcesFetchResult | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    setRes(await fetchSources());
    setLoading(false);
  };

  if (res && !res.ok && res.code === "NOT_DEPLOYED") return null;
  return (
    <details className="panel collapsible" onToggle={(e) => { if ((e.target as HTMLDetailsElement).open && !res && !loading) load(); }}>
      <summary><h2>Data sources</h2></summary>
      {loading && <p className="muted" aria-live="polite">Loading source summary…</p>}
      {res && !res.ok && (
        <p className="error" role="status">Source summary unavailable: {res.message}. <button type="button" onClick={load}>Retry</button></p>
      )}
      {res?.ok && (
        <>
          <p className="muted small">Summary generated {day(res.generatedAt)} · data mode: {res.dataMode.replace(/_/g, " ")}</p>
          {res.rows.length === 0 ? (
            <p className="muted">No sources are listed yet.</p>
          ) : (
            <ul className="card-list">
              {res.rows.map((r) => (
                <li key={r.source_kind + r.name} className="card">
                  <strong>
                    {/^https?:\/\//.test(r.source_url) ? <a href={r.source_url} target="_blank" rel="noopener noreferrer">{r.name}</a> : r.name}
                  </strong>
                  <p className="muted small">
                    {r.publisher} · {r.count_current} current{r.count_outdated ? `, ${r.count_outdated} outdated` : ""} · source updated {day(r.source_layer_updated_at)} · last import {day(r.last_successful_ingest_at)}
                  </p>
                  <dl className="small">
                    <dt>Shows</dt><dd>{r.what_it_proves}</dd>
                    <dt>Does not show</dt><dd>{r.what_it_does_not_prove}</dd>
                  </dl>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </details>
  );
}
