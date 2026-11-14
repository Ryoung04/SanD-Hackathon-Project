"use client";

import { useEffect, useRef, useState } from "react";
import { investigate, speak, type InvestigateResult } from "@/lib/ui/evidenceClient";

// Remember per page-load that an optional endpoint isn't deployed, so its button stays hidden.
const notDeployed = { investigate: false, speak: false };

/**
 * Optional Owner C actions on a selected record. Shell: each button hides itself if its
 * endpoint returns 404. Failures show a short message; the record detail stays usable.
 */
export default function EvidenceActions({ observationId, onScreenText }: { observationId: string; onScreenText: string }) {
  const [, force] = useState(0);
  const [explain, setExplain] = useState<InvestigateResult | null>(null);
  const [busy, setBusy] = useState<"investigate" | "speak" | null>(null);
  const [speakMsg, setSpeakMsg] = useState<string | null>(null);
  const audioUrl = useRef<string | null>(null);

  useEffect(() => { setExplain(null); setSpeakMsg(null); }, [observationId]);
  useEffect(() => () => { if (audioUrl.current) URL.revokeObjectURL(audioUrl.current); }, []);

  const onExplain = async () => {
    setBusy("investigate");
    const r = await investigate(observationId);
    if (!r.ok && r.code === "NOT_DEPLOYED") { notDeployed.investigate = true; force((n) => n + 1); }
    setExplain(r);
    setBusy(null);
  };

  const onSpeak = async () => {
    setBusy("speak");
    setSpeakMsg(null);
    const r = await speak(onScreenText);
    if (r.ok) {
      if (audioUrl.current) URL.revokeObjectURL(audioUrl.current);
      audioUrl.current = URL.createObjectURL(r.audio);
      new Audio(audioUrl.current).play().catch(() => setSpeakMsg("Audio could not be played."));
    } else {
      if (r.code === "NOT_DEPLOYED") { notDeployed.speak = true; force((n) => n + 1); }
      setSpeakMsg(r.message);
    }
    setBusy(null);
  };

  if (notDeployed.investigate && notDeployed.speak) return null;
  return (
    <div className="evidence-actions">
      <div className="row">
        {!notDeployed.investigate && (
          <button type="button" onClick={onExplain} disabled={busy !== null}>{busy === "investigate" ? "Explaining…" : "Explain evidence (AI)"}</button>
        )}
        {!notDeployed.speak && (
          <button type="button" onClick={onSpeak} disabled={busy !== null}>{busy === "speak" ? "Loading audio…" : "Read aloud"}</button>
        )}
      </div>
      <div aria-live="polite">
        {explain?.ok && (
          <div className="caveat small">
            <strong>AI explanation (unverified):</strong> {explain.explanation}
          </div>
        )}
        {explain && !explain.ok && explain.code !== "NOT_DEPLOYED" && <p className="error small">{explain.message}</p>}
        {speakMsg && !notDeployed.speak && <p className="error small">{speakMsg}</p>}
      </div>
    </div>
  );
}
