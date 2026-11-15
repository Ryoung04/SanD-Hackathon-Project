"use client";
import { useRef, useState } from "react";
import { searchPlaces, type Place } from "../lib/ui/placeSearch";

type Props = {
  id: string;
  label: string;
  onSelect: (p: { lat: number; lon: number }, label: string) => void;
};

export default function PlaceSearch({ id, label, onSelect }: Props) {
  const [query, setQuery] = useState("");
  const [places, setPlaces] = useState<Place[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const loading = useRef(false);

  const results = places ? searchPlaces(places, query) : [];
  const listId = `${id}-listbox`;
  const showList = open && results.length > 0;

  async function load() {
    if (places || loading.current) return;
    loading.current = true;
    try {
      const res = await fetch("/data/downtown-places.json");
      if (!res.ok) throw new Error(String(res.status));
      const json = await res.json();
      setPlaces(Array.isArray(json?.places) ? json.places : []);
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      loading.current = false;
    }
  }

  function choose(p: Place) {
    setQuery(p.name);
    setOpen(false);
    setActive(-1);
    onSelect({ lat: p.lat, lon: p.lon }, p.name);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!results.length) return;
      setOpen(true);
      setActive((a) => (a + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!results.length) return;
      setOpen(true);
      setActive((a) => (a <= 0 ? results.length - 1 : a - 1));
    } else if (e.key === "Enter") {
      if (showList && active >= 0) {
        e.preventDefault();
        choose(results[active]);
      }
    } else if (e.key === "Escape") {
      if (open) e.preventDefault();
      setOpen(false);
      setActive(-1);
    }
  }

  return (
    <div className="place-search">
      <label className="field" htmlFor={id}>
        <span>{label}</span>
        <input
          id={id}
          type="text"
          role="combobox"
          autoComplete="off"
          aria-autocomplete="list"
          aria-expanded={showList}
          aria-controls={listId}
          aria-activedescendant={showList && active >= 0 ? `${id}-opt-${active}` : undefined}
          value={query}
          placeholder="e.g. Petco Park or 5th & Market"
          onFocus={() => { void load(); setOpen(true); }}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); setActive(-1); }}
          onBlur={() => { setOpen(false); setActive(-1); }}
          onKeyDown={onKeyDown}
        />
      </label>
      {failed && <p className="error small" role="status">Search unavailable; enter lat, lon</p>}
      <ul id={listId} role="listbox" aria-label={`${label} suggestions`} className="place-search__list" hidden={!showList}>
        {results.map((p, i) => (
          <li
            key={`${p.name}-${p.lat}-${p.lon}`}
            id={`${id}-opt-${i}`}
            role="option"
            aria-selected={i === active}
            className={i === active ? "place-search__opt is-active" : "place-search__opt"}
            onMouseDown={(e) => { e.preventDefault(); choose(p); }}
            onMouseEnter={() => setActive(i)}
          >
            <span>{p.name}</span> <span className="muted small">{p.kind}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
