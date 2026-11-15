import { test } from "node:test";
import assert from "node:assert/strict";
import { loadRouteObservations } from "../../src/lib/ui/routeClient";

const obs = (id: string) => ({ id, source_kind: "city_311" }) as never;
const json = (body: unknown, ok = true) => ({ ok, json: async () => body }) as Response;
const line: [number, number][] = [[-117.1698, 32.7172], [-117.1615, 32.7151]];

test("pages over the padded route bbox and returns only the wanted ids", async () => {
  const urls: string[] = [];
  const pages = [
    { data: [obs("a"), obs("x")], meta: { next_cursor: "x" } },
    { data: [obs("b")], meta: { next_cursor: "b" } },
  ];
  const got = await loadRouteObservations(line, ["a", "b"], async (u) => { urls.push(u); return json(pages[urls.length - 1]); });
  assert.deepEqual(got.map((o: { id: string }) => o.id), ["a", "b"]);
  assert.equal(urls.length, 2, "stops once every id is found");
  assert.match(urls[1], /cursor=x/);
  const [w, s, e, n] = new URL(urls[0], "http://h").searchParams.get("bbox")!.split(",").map(Number);
  assert.ok(w < -117.1698 && e > -117.1615 && s < 32.7151 && n > 32.7172, "bbox padded around the route");
});

test("best effort: network or HTTP errors return what was found", async () => {
  assert.deepEqual(await loadRouteObservations(line, ["a"], async () => { throw new Error("offline"); }), []);
  assert.deepEqual(await loadRouteObservations(line, ["a"], async () => json({}, false)), []);
  assert.deepEqual(await loadRouteObservations(line, [], async () => { throw new Error("no call"); }), []);
});
