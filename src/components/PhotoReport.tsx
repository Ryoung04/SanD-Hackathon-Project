"use client";

import { useState } from "react";
import { humanize } from "@/lib/ui/caveats";
import { analyzeImage, validateUpload, type AnalyzeResult } from "@/lib/ui/evidenceClient";
import { parseLatLon, type LatLon } from "@/lib/ui/routeClient";

/**
 * Photo report shell (Owner C's POST /api/analyze-image). Results are AI candidates,
 * never verified barriers. Optional: the rest of the app works if this service is down.
 */
export default function PhotoReport({ suggestedLocation, onSaved }: { suggestedLocation: LatLon | null; onSaved: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [permission, setPermission] = useState(false);
  const [locText, setLocText] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<AnalyzeResult | null>(null);

  const loc = locText.trim() ? parseLatLon(locText) : null;
  const locInvalid = locText.trim() !== "" && !loc;
  const precheck = file ? validateUpload({ file, permissionConfirmed: permission }) : "Choose an image file.";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || precheck || locInvalid) return;
    setBusy(true);
    const r = await analyzeImage({ file, permissionConfirmed: permission, location: loc });
    setRes(r);
    setBusy(false);
    if (r.ok && r.saved) onSaved();
  };

  return (
    <details className="panel collapsible">
      <summary><h2>Report with a photo (AI, optional)</h2></summary>
      <form className="route-form" onSubmit={submit}>
        <label className="field">
          <span>Photo (max 5 MB)</span>
          <input type="file" accept="image/*" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setRes(null); }} />
        </label>
        <label className="check">
          <input type="checkbox" checked={permission} onChange={(e) => setPermission(e.target.checked)} />
          <span>I took this photo or have the right to submit it. No faces or personal details.</span>
        </label>
        <div className="field">
          <label htmlFor="photo-loc">Camera location (lat, lon), optional</label>
          <div className="row">
            <input id="photo-loc" value={locText} aria-invalid={locInvalid} placeholder="Leave blank to skip the map" onChange={(e) => setLocText(e.target.value)} />
            {suggestedLocation && (
              <button type="button" onClick={() => setLocText(`${suggestedLocation.lat.toFixed(5)}, ${suggestedLocation.lon.toFixed(5)}`)}>Use trip start</button>
            )}
          </div>
          {locInvalid && <span className="error small">Enter latitude, longitude.</span>}
        </div>
        <button type="submit" className="btn-primary" disabled={busy || !!precheck || locInvalid}>
          {busy ? "Analyzing (5–15 s)…" : "Analyze photo"}
        </button>
        {file && precheck && <span className="muted small">{precheck}</span>}
      </form>

      <div aria-live="polite">
        {res && !res.ok && <p className="error" role="status">Analysis unavailable: {res.message}</p>}
        {res?.ok && (
          <div className="route-result">
            <p className="badge badge--ai">AI candidates — unverified{res.requires_human_review ? ", needs human review" : ""}</p>
            {res.candidates.length === 0 ? (
              <p className="muted">No potential barrier detected. This does not mean the place is accessible.</p>
            ) : (
              <ul>
                {res.candidates.map((c, i) => (
                  <li key={i}>
                    <strong>{humanize(c.category)}</strong> <span className="muted small">(model confidence: {c.model_confidence})</span>
                    <div className="small">{c.explanation}</div>
                  </li>
                ))}
              </ul>
            )}
            <p className="muted small">{res.location_note}{res.saved ? " Added to the map as an AI candidate." : ""}</p>
          </div>
        )}
      </div>
    </details>
  );
}
