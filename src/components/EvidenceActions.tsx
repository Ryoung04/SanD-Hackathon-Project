"use client";

import { useEffect, useRef, useState } from "react";
import { investigate, speak, type InvestigateResult } from "@/lib/ui/evidenceClient";

// Remember per page-load that an optional endpoint isn't deployed, so its button stays hidden.
const notDeployed = { investigate: false, speak: false };

interface Props {
  /** Record id plus its marker point; /api/investigate looks the record up near lat/lon. */
  target: { id: string; lat: number; lon: number } | null;
  /** Text already visible in the detail panel; read aloud until an AI summary is shown. */
  onScreenText: string;
}

/**
 * Optional Owner C actions on a selected record:
 *  - "Explain evidence" -> POST /api/investigate (default: instant brief built from the records, no AI).
 *  - "Read aloud" -> POST /api/speak (ElevenLabs). Speaks only on-screen text.
 * Each button hides itself if its endpoint isn't deployed. Errors show a short message;
 * the record detail stays usable. The AI summary is labelled unverified and informational.
 */
export default function EvidenceActions({ target, onScreenText }: Props) {
  const [, force] = useState(0);
  const [explain, setExplain] = useState<InvestigateResult | null>(null);
  const [busy, setBusy] = useState<"investigate" | "speak" | null>(null);
  const [speakMsg, setSpeakMsg] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const audioUrl = useRef<string | null>(null);
  // Kept in the DOM: some Chrome setups abort play() on a detached `new Audio()`.
  const audio = useRef<HTMLAudioElement | null>(null);

  const stopAudio = () => {
    const a = audio.current;
    if (a && !a.paused) { a.pause(); a.currentTime = 0; }
    setPlaying(false);
  };

  useEffect(() => { stopAudio(); setExplain(null); setSpeakMsg(null); }, [target?.id]);
  useEffect(() => () => { stopAudio(); if (audioUrl.current) URL.revokeObjectURL(audioUrl.current); }, []);

  const onExplain = async () => {
    if (!target) return;
    setBusy("investigate");
    const r = await investigate(target);
    if (!r.ok && r.code === "NOT_DEPLOYED") { notDeployed.investigate = true; force((n) => n + 1); }
    setExplain(r);
    setBusy(null);
  };

  const onSpeak = async () => {
    stopAudio();
    setBusy("speak");
    setSpeakMsg(null);
    // Once the AI summary is on screen, read that (with its caveat); otherwise the record text.
    const text = explain?.ok ? `${explain.summary} ${explain.note ?? "Summary of public records, unverified."}` : onScreenText;
    const r = await speak(text);
    if (r.ok) {
      if (audioUrl.current) URL.revokeObjectURL(audioUrl.current);
      audioUrl.current = URL.createObjectURL(r.audio);
      const a = audio.current;
      if (a) {
        a.src = audioUrl.current;
        setPlaying(true);
        a.play().catch((e: unknown) => {
          setPlaying(false);
          // AbortError just means Stop (or a new clip) interrupted it.
          if (!(e instanceof DOMException && e.name === "AbortError")) setSpeakMsg("Audio could not be played.");
        });
      }
    } else {
      if (r.code === "NOT_DEPLOYED") { notDeployed.speak = true; force((n) => n + 1); }
      setSpeakMsg(r.message);
    }
    setBusy(null);
  };

  if (notDeployed.investigate && notDeployed.speak) return null;
  const canExplain = !notDeployed.investigate && target !== null;
  return (
    <div className="evidence-actions">
      <audio ref={audio} hidden preload="none" onEnded={() => setPlaying(false)} />
      <div className="row">
        {canExplain && (
          <button type="button" onClick={onExplain} disabled={busy !== null}>{busy === "investigate" ? "Explaining…" : "Explain evidence"}</button>
        )}
        {!notDeployed.speak && (
          playing ? (
            <button type="button" onClick={stopAudio} aria-label="Stop reading aloud">Stop</button>
          ) : (
            <button type="button" onClick={onSpeak} disabled={busy !== null}>{busy === "speak" ? "Loading audio…" : explain?.ok ? "Read summary aloud" : "Read aloud"}</button>
          )
        )}
      </div>
      <div aria-live="polite">
        {explain?.ok && (
          <div className="caveat small investigation">
            <p><strong>Evidence summary (unverified):</strong> {explain.summary}</p>
            {explain.note && <p className="muted">{explain.note}</p>}
            {explain.uncertainties.length > 0 && (
              <>
                <p><strong>Uncertain:</strong></p>
                <ul>{explain.uncertainties.map((u, i) => <li key={i}>{u}</li>)}</ul>
              </>
            )}
            {explain.conflicts.length > 0 && (
              <>
                <p><strong>Conflicting records:</strong></p>
                <ul>{explain.conflicts.map((c, i) => <li key={i}>{c}</li>)}</ul>
              </>
            )}
            {explain.source_links.length > 0 && (
              <>
                <p><strong>Sources cited:</strong></p>
                <ul>{explain.source_links.map((u) => <li key={u}><a href={u} target="_blank" rel="noopener noreferrer">{u.replace(/^https?:\/\//, "").slice(0, 60)}</a></li>)}</ul>
              </>
            )}
            <p className="muted">Informational only: this does not change routing or confirm a barrier.</p>
          </div>
        )}
        {explain && !explain.ok && explain.code !== "NOT_DEPLOYED" && <p className="error small">{explain.message}</p>}
        {speakMsg && !notDeployed.speak && <p className="error small">{speakMsg}</p>}
      </div>
    </div>
  );
}
