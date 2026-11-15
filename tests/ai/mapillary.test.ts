import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { bearingDeg, isAllowedThumbUrl, rankImages, findImagesNear, mapillaryReference, downloadThumb, type MapillaryImage } from "@/lib/ai/mapillary";

const img = (o: Partial<MapillaryImage>): MapillaryImage => ({
  id: "1", captured_at: "2024-01-01", lon: -117.16, lat: 32.72, compass_angle: 0, is_pano: false,
  thumb_url: "https://scontent-lax3-2.xx.fbcdn.net/a.jpg", creator: "u", distance_m: 10, heading_off_deg: 10, ...o,
});

describe("isAllowedThumbUrl", () => {
  it.each([
    ["https://scontent-lax3-2.xx.fbcdn.net/v/t6/x.jpg", true],
    ["http://scontent.xx.fbcdn.net/x.jpg", false],
    ["https://fbcdn.net.evil.com/x.jpg", false],
    ["https://user@scontent.xx.fbcdn.net/x.jpg", false],
    ["https://scontent.xx.fbcdn.net:8443/x.jpg", false],
    ["https://evil.com/?u=fbcdn.net", false],
    ["not a url", false],
  ])("%s -> %s", (u, ok) => expect(isAllowedThumbUrl(u)).toBe(ok));
});

describe("bearingDeg", () => {
  it("north/east are ~0/~90", () => {
    expect(Math.round(bearingDeg([-117.16, 32.72], [-117.16, 32.73]))).toBe(0);
    expect(Math.round(bearingDeg([-117.16, 32.72], [-117.15, 32.72]))).toBe(90);
  });
});

describe("rankImages", () => {
  it("drops panoramas and prefers facing, close, recent", () => {
    const r = rankImages([
      img({ id: "pano", is_pano: true, heading_off_deg: 0, distance_m: 1 }),
      img({ id: "away", heading_off_deg: 170 }),
      img({ id: "old", captured_at: "2015-01-01" }),
      img({ id: "best", captured_at: "2025-01-01" }),
    ]);
    expect(r.map((i) => i.id)).toEqual(["best", "old", "away"]);
  });
});

describe("findImagesNear", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    process.env.MAPILLARY_TOKEN = "MLY|1|x";
  });
  afterEach(() => vi.unstubAllGlobals());

  it("filters by radius and thumb host, sends token as header (not URL)", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: [
      { id: "a", captured_at: Date.parse("2024-12-18"), computed_geometry: { coordinates: [-117.16, 32.7201] }, compass_angle: 180, is_pano: false, thumb_1024_url: "https://scontent.xx.fbcdn.net/a.jpg", creator: { username: "kaart" } },
      { id: "far", captured_at: 0, computed_geometry: { coordinates: [-117.17, 32.72] }, compass_angle: 0, is_pano: false, thumb_1024_url: "https://scontent.xx.fbcdn.net/b.jpg" },
      { id: "badhost", captured_at: 0, computed_geometry: { coordinates: [-117.16, 32.72] }, compass_angle: 0, is_pano: false, thumb_1024_url: "https://evil.com/c.jpg" },
    ] })));
    const r = await findImagesNear(32.72, -117.16, 30);
    expect(r.map((i) => i.id)).toEqual(["a"]);
    expect(r[0].heading_off_deg).toBe(0); // camera 11 m north facing south -> facing target
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).not.toContain("MLY");
    expect(init.headers.Authorization).toBe("OAuth MLY|1|x");
  });
  it("throws on API error", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { message: "Invalid OAuth" } }), { status: 401 }));
    await expect(findImagesNear(32.72, -117.16)).rejects.toThrow(/401/);
  });
  it("downloadThumb rejects non-images and disallowed hosts", async () => {
    fetchMock.mockResolvedValue(new Response("<html>", { status: 200 }));
    await expect(downloadThumb(img({}))).rejects.toThrow(/not an image/);
    await expect(downloadThumb(img({ thumb_url: "https://evil.com/x.jpg" }))).rejects.toThrow(/host/);
  });
});

describe("mapillaryReference", () => {
  it("carries license, attribution, camera location and page link", () => {
    const r = mapillaryReference(img({ id: "42", creator: null }));
    expect(r).toMatchObject({ image_reference: "mapillary:42", source: "mapillary", license: "CC BY-SA 4.0", captured_at: "2024-01-01" });
    expect(r.page_url).toBe("https://www.mapillary.com/app/?pKey=42");
    expect(r.attribution).toMatch(/Mapillary contributor/);
  });
});

import { candidateGate } from "@/lib/ai/imageObservations";
describe("candidateGate (real Gemini outputs from the 2026-11-14 batch)", () => {
  const c = (explanation: string, model_confidence = "likely") => ({ category: "sidewalk_obstruction", explanation, model_confidence });
  it.each([
    ["A white Jeep is parked on the street, but it is unclear if it is encroaching on the sidewalk area.", "hedged"],
    ["Multiple vehicles are parked in the area adjacent to the building, which may obstruct potential pedestrian paths.", "vehicle_not_on_walkway"],
    ["A dark SUV is parked in the foreground, obstructing the view of the sidewalk and curb area.", "hedged"],
    ["A tent is set up on the sidewalk, narrowing the path.", "people_or_belongings"],
    ["Several people are standing near the ramp.", "people_or_belongings"],
    ["A sign stands near the corner.", "low_confidence"],
  ])("%s -> %s", (e, why) => expect(candidateGate(c(e, why === "low_confidence" ? "uncertain" : "likely"))).toBe(why));
  it.each([
    "A utility pole is located directly on the sidewalk, which may obstruct passage.",
    "A delivery truck is parked on the sidewalk blocking the curb ramp.",
    "Construction fencing extends across the walkway.",
  ])("keeps: %s", (e) => expect(candidateGate(c(e))).toBeNull());
});
