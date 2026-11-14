// Bright Data Web Unlocker client (server-only). Owner C.
import "server-only";
// Policy: Bright Data refuses Government-classified sites (e.g. sandiego.gov).
// We do not attempt to route around that; official data comes from public
// city APIs directly (Owner A), never through Bright Data.

const ENDPOINT = "https://api.brightdata.com/request";

// SSRF guard: only these hosts may be fetched. Extend deliberately.
// Never allowlist hosts with open redirectors (e.g. google.com/url?q=), which
// would bypass both this list and Bright Data's Government-site policy.
const ALLOWED_HOSTS = new Set(["timesofsandiego.com"]);

export class BrightDataError extends Error {
  constructor(
    public code: "CONFIG" | "HOST_NOT_ALLOWED" | "POLICY_BLOCKED" | "UPSTREAM",
    message: string,
  ) {
    super(message);
  }
}

export interface BrightDataResult {
  requested_url: string;
  body: string;
  retrieved_at: string; // UTC ISO
  provider: "bright_data_web_unlocker";
  zone: string;
}

export function assertAllowedUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new BrightDataError("HOST_NOT_ALLOWED", "invalid URL");
  }
  if (u.protocol !== "https:") throw new BrightDataError("HOST_NOT_ALLOWED", "https only");
  if (u.username || u.password || u.port) throw new BrightDataError("HOST_NOT_ALLOWED", "credentials/ports not allowed");
  const host = u.hostname.toLowerCase().replace(/\.+$/, "");
  if (/\.(gov|mil)$/.test(host))
    throw new BrightDataError("POLICY_BLOCKED", `${host}: government sites are not fetched via Bright Data`);
  if (host !== u.hostname || !ALLOWED_HOSTS.has(host)) throw new BrightDataError("HOST_NOT_ALLOWED", `${host} not allowlisted`);
  return u;
}

export async function brightDataFetch(
  url: string,
  opts: { dataFormat?: "markdown"; timeoutMs?: number } = {},
): Promise<BrightDataResult> {
  const key = process.env.BRIGHTDATA_API_KEY;
  const zone = process.env.BRIGHTDATA_ZONE ?? "cli_unlocker";
  if (!key) throw new BrightDataError("CONFIG", "BRIGHTDATA_API_KEY not set");
  const target = assertAllowedUrl(url).href; // send the parsed URL, never the raw string

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ zone, url: target, format: "raw", ...(opts.dataFormat ? { data_format: opts.dataFormat } : {}) }),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000),
  });
  const retrieved_at = new Date().toISOString();
  // Bright Data reports target/proxy failures in headers with HTTP 200.
  const brdError = res.headers.get("x-brd-error");
  if (brdError) {
    const blocked = /blocked by Bright Data|usage policy/i.test(brdError);
    throw new BrightDataError(blocked ? "POLICY_BLOCKED" : "UPSTREAM", brdError.slice(0, 300));
  }
  if (!res.ok) throw new BrightDataError("UPSTREAM", `HTTP ${res.status}`);
  return { requested_url: target, body: await res.text(), retrieved_at, provider: "bright_data_web_unlocker", zone };
}
