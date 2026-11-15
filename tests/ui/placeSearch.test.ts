import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPlacesFromOverpass, searchPlaces, type Place } from "../../src/lib/ui/placeSearch";

const BBOX = [-117.175, 32.712, -117.15, 32.73] as const;

const fake = {
  elements: [
    { type: "node", id: 1, lat: 32.7150, lon: -117.1600 },
    { type: "node", id: 2, lat: 32.7150, lon: -117.1650 },
    { type: "node", id: 3, lat: 32.7152, lon: -117.1600 }, // ~22 m from node 1 (dedupe pair)
    { type: "node", id: 4, lat: 32.8000, lon: -117.1600 }, // outside bbox
    { type: "node", id: 5, lat: 32.7000, lon: -117.1600 },
    { type: "way", id: 10, tags: { name: "5th Avenue", highway: "primary" }, nodes: [1, 3, 2, 4] },
    { type: "way", id: 11, tags: { name: "Market Street", highway: "secondary" }, nodes: [1, 3] },
    { type: "way", id: 12, tags: { name: "Alley Way", highway: "service" }, nodes: [1] },
    { type: "way", id: 13, tags: { name: "Foot Path", highway: "footway" }, nodes: [2] },
    { type: "way", id: 14, tags: { name: "Far Street", highway: "primary" }, nodes: [4, 5] },
    { type: "way", id: 15, tags: { name: "Other Avenue", highway: "primary" }, nodes: [4, 5] },
    { type: "node", id: 20, lat: 32.7076, lon: -117.157, tags: { name: "Petco Park", leisure: "stadium" } },
    { type: "node", id: 21, lat: 32.7200, lon: -117.1600, tags: { name: "Far Park", leisure: "park" } },
    { type: "way", id: 22, center: { lat: 32.7160, lon: -117.1620 }, tags: { name: "Balboa Theatre", amenity: "theatre" } },
    { type: "way", id: 23, center: { lat: 32.9, lon: -117.1620 }, tags: { name: "Outside Cafe", amenity: "cafe" } },
    { type: "node", id: 24, lat: 32.7160, lon: -117.1620, tags: { amenity: "cafe" } }, // no name
  ],
};

test("buildPlaces: extracts intersection, ignores service/footway, dedupes pair", () => {
  const places = buildPlacesFromOverpass(fake, BBOX);
  const ix = places.filter((p) => p.kind === "intersection");
  assert.equal(ix.length, 1);
  assert.equal(ix[0].name, "5th Avenue & Market Street");
  assert.equal(ix[0].lat, 32.715);
});

test("buildPlaces: bbox filtering", () => {
  const names = buildPlacesFromOverpass(fake, BBOX).map((p) => p.name);
  assert.ok(!names.includes("Outside Cafe"));
  assert.ok(!names.some((n) => n.includes("Far Street")));
  assert.ok(names.includes("Balboa Theatre")); // way center used
});

test("buildPlaces: dedupes same names within 30 m, keeps farther ones", () => {
  const els = [
    { type: "node", id: 1, lat: 32.72, lon: -117.16, tags: { name: "Cafe A", amenity: "cafe" } },
    { type: "node", id: 2, lat: 32.72001, lon: -117.16, tags: { name: "Cafe A", amenity: "cafe" } },
    { type: "node", id: 3, lat: 32.725, lon: -117.16, tags: { name: "Cafe A", amenity: "cafe" } },
  ];
  assert.equal(buildPlacesFromOverpass({ elements: els }, BBOX).length, 2);
});

const P: Place[] = [
  { name: "5th Avenue & Market Street", kind: "intersection", lat: 1, lon: 1 },
  { name: "Petco Park", kind: "park", lat: 2, lon: 2 },
  { name: "Petco Park Store", kind: "shop", lat: 3, lon: 3 },
  { name: "Fifth Avenue Cafe", kind: "cafe", lat: 4, lon: 4 },
  { name: "Harbor Drive & 8th Avenue", kind: "intersection", lat: 5, lon: 5 },
];

test("search: empty and 1-char queries return []", () => {
  assert.deepEqual(searchPlaces(P, ""), []);
  assert.deepEqual(searchPlaces(P, "  "), []);
  assert.deepEqual(searchPlaces(P, "p"), []);
});

test("search: case-insensitive, exact before prefix, shorter first", () => {
  const r = searchPlaces(P, "PETCO park");
  assert.deepEqual(r.map((p) => p.name), ["Petco Park", "Petco Park Store"]);
});

test("search: abbreviations both ways", () => {
  assert.equal(searchPlaces(P, "5th ave & market st")[0].name, "5th Avenue & Market Street");
  assert.equal(searchPlaces(P, "fifth avenue")[0].name, "Fifth Avenue Cafe");
  assert.ok(searchPlaces(P, "5th ave").some((p) => p.name === "5th Avenue & Market Street"));
  assert.equal(searchPlaces(P, "harbor dr and 8th ave")[0].name, "Harbor Drive & 8th Avenue");
});

test("search: reversed intersection order and separators", () => {
  for (const q of ["market & 5th", "Market and 5th", "market at 5th", "market/5th"]) {
    assert.equal(searchPlaces(P, q)[0]?.name, "5th Avenue & Market Street", q);
  }
});

test("search: non-matching and limit", () => {
  assert.deepEqual(searchPlaces(P, "zzzz"), []);
  assert.equal(searchPlaces(P, "petco", 1).length, 1);
});
