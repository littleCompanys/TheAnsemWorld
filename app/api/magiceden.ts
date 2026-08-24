/**
 * Server-side proxy for the Magic Eden instructions API.
 *
 * Runs as a Vercel function, not in the browser, for one reason: the
 * instruction endpoints need an API key, and anything Vite bundles is
 * readable by every visitor. The key stays in MAGIC_EDEN_API_KEY on the
 * server and never reaches the client.
 *
 * Only the endpoints below are reachable. Without that allowlist this
 * becomes an open relay that anyone can point at any Magic Eden route
 * using your key and your rate limit.
 *
 * Note on clusters: Magic Eden's devnet API is gone - its instruction
 * routes answer 503 "failure to get a peer from the ring-balancer",
 * meaning nothing is deployed behind them. Only mainnet works, so this
 * is only useful once the protocol is on mainnet.
 */

const BASE = "https://api-mainnet.magiceden.dev/v2";

/** Endpoints this proxy will forward, and nothing else. */
const ALLOWED = new Set([
  "instructions/sell",
  "instructions/sell-cancel",
  "instructions/sell-change-price",
  "instructions/sell-now",
  "instructions/buy",
  "instructions/buy-now",
  "instructions/buy-cancel",
  "instructions/buy-change-price",
]);

export default async function handler(req: Request): Promise<Response> {
  const key = process.env.MAGIC_EDEN_API_KEY;
  if (!key) {
    return json(500, { error: "MAGIC_EDEN_API_KEY is not set on the server" });
  }

  const url = new URL(req.url);
  // Called as /api/magiceden?endpoint=instructions/buy-now&...
  const endpoint = url.searchParams.get("endpoint") ?? "";
  if (!ALLOWED.has(endpoint)) {
    return json(400, {
      error: `endpoint not allowed: ${endpoint || "(none)"}`,
      allowed: [...ALLOWED],
    });
  }

  const forward = new URLSearchParams(url.searchParams);
  forward.delete("endpoint");

  try {
    const res = await fetch(`${BASE}/${endpoint}?${forward}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    const body = await res.text();
    // Pass the upstream status through: 401 means the key is wrong, 429
    // means rate limited, and the caller should be able to tell.
    return new Response(body, {
      status: res.status,
      headers: { "content-type": "application/json" },
    });
  } catch (e) {
    return json(502, { error: `magic eden unreachable: ${String(e)}` });
  }
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
