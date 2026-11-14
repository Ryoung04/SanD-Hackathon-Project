import type { ApiError, BarriersResponse, BBox, SourceKind } from "./barrierTypes";
import { fixtureResponse } from "./fixtures";

/** Snap bbox outward to a grid so small pans reuse the same cached request. */
export function quantizeBBox(b: BBox, step = 0.005): BBox {
  const down = (v: number) => Math.floor(v / step) * step;
  const up = (v: number) => Math.ceil(v / step) * step;
  const r = (v: number) => Number(v.toFixed(6));
  return [r(down(b[0])), r(down(b[1])), r(up(b[2])), r(up(b[3]))];
}

export function bboxParam(b: BBox): string {
  return b.join(",");
}

export interface LoadResult {
  response: BarriersResponse;
  /** Set when the live endpoint failed and the fixture was used instead. */
  liveError: string | null;
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const cache = new Map<string, Promise<LoadResult>>();
const MAX_CACHE = 50;

export function clearBarrierCache() {
  cache.clear();
}

/**
 * GET /api/barriers?bbox=... (Owner A). On network/HTTP/shape failure, falls
 * back to the labelled demo fixture and reports the error so the UI can say so.
 */
export function loadBarriers(bbox: BBox, fetchImpl: FetchLike = fetch): Promise<LoadResult> {
  const q = quantizeBBox(bbox);
  const key = bboxParam(q);
  const hit = cache.get(key);
  if (hit) return hit;

  const p = (async (): Promise<LoadResult> => {
    await Promise.resolve(); // ensure cache.set below runs before any catch/delete
    try {
      const res = await fetchImpl(`/api/barriers?bbox=${encodeURIComponent(key)}`);
      const body = (await res.json().catch(() => null)) as BarriersResponse | ApiError | null;
      if (!res.ok || !body || !("data" in body) || !Array.isArray(body.data)) {
        const msg = body && "error" in body ? `${body.error.code}: ${body.error.message}` : `HTTP ${res.status}`;
        throw new Error(msg);
      }
      return { response: body, liveError: null };
    } catch (e) {
      cache.delete(key); // retry live next time instead of pinning the fixture
      return { response: fixtureResponse(q), liveError: e instanceof Error ? e.message : String(e) };
    }
  })();

  cache.set(key, p);
  if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value as string);
  return p;
}

export function filterBySource<T extends { source_kind: SourceKind }>(items: T[], enabled: ReadonlySet<SourceKind>): T[] {
  return items.filter((o) => enabled.has(o.source_kind));
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  let t: ReturnType<typeof setTimeout> | undefined;
  const wrapped = (...args: A) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  wrapped.cancel = () => t && clearTimeout(t);
  return wrapped;
}
