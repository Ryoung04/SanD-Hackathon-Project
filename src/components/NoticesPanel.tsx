"use client";

import { useState } from "react";
import { dateOrUnknown } from "@/lib/ui/caveats";
import { fetchNotices, type NoticesResult } from "@/lib/ui/evidenceClient";

const safeHttp = (u: string) => { try { const p = new URL(u); return p.protocol === "https:" || p.protocol === "http:" ? p.href : null; } catch { return null; } };

/** Construction news cards (Owner C, via Bright Data). Loaded on first open; never blocks the map. */
export default function NoticesPanel({ onSelect }: { onSelect: (observationId: string) => void }) {
  const [res, setRes] = useState<NoticesResult | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    setRes(await fetchNotices());
    setLoading(false);
  };

  return (
    <details className="panel collapsible" onToggle={(e) => { if ((e.target as HTMLDetailsElement).open && !res && !loading) load(); }}>
      <summary><h2>Construction news</h2></summary>
      {loading && <p className="muted" aria-live="polite">Loading notices…</p>}
      {res && !res.ok && (
        <p className="error" role="status">Notices unavailable: {res.message}. <button type="button" onClick={load}>Retry</button></p>
      )}
      {res?.ok && (
        <>
          <p className="caveat small">{res.source_note}</p>
          <p className="muted small">
            {res.refreshed_at ? `Last refreshed ${dateOrUnknown(res.refreshed_at)}.` : "No notices fetched yet."}
          </p>
          {res.cards.length === 0 ? (
            <p className="muted">No construction notices cached. This does not mean there is no construction.</p>
          ) : (
            <ul className="card-list">
              {res.cards.map((c) => {
                const url = safeHttp(c.notice.source_url);
                return (
                  <li key={c.notice.source_url} className="card">
                    <h3>{url ? <a href={url} target="_blank" rel="noopener noreferrer">{c.notice.page_title}</a> : c.notice.page_title}</h3>
                    <p className="muted small">
                      {c.notice.source_name ?? "News report"} · published {dateOrUnknown(c.notice.published_at)}
                      {c.notice.cross_streets.length ? ` · ${c.notice.cross_streets.join(" / ")}` : ""}
                    </p>
                    {c.notice.pedestrian_impact_found && c.notice.pedestrian_impact_language.length > 0 ? (
                      <blockquote className="small">“{c.notice.pedestrian_impact_language[0]}”</blockquote>
                    ) : (
                      <p className="small">No pedestrian impact mentioned in the article.</p>
                    )}
                    <p className="small">
                      {c.matched_permit_ids.length ? `Matches ${c.matched_permit_ids.length} city permit(s) by date.` : "No matching city permit."}{" "}
                      A permit or news report is not proof a sidewalk is blocked.
                    </p>
                    {c.observation_id ? (
                      <button type="button" onClick={() => onSelect(c.observation_id!)}>Show on map</button>
                    ) : (
                      <p className="muted small">Text-only location: not placed on the map.</p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </details>
  );
}
