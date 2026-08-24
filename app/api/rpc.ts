/**
 * Server-side proxy for Solana JSON-RPC calls.
 *
 * Runs as a Vercel function, not in the browser, for the same reason
 * api/magiceden.ts does: the dedicated RPC needs an API key, and
 * anything Vite bundles as VITE_* is readable by every visitor. The
 * key stays in RPC_ENDPOINT on the server and never reaches the client
 * - the frontend points its Connection at /api/rpc instead.
 *
 * Trade-off: this is HTTP-only, so live push updates via
 * connection.onAccountChange (a WebSocket) do not work through it -
 * Vercel's serverless functions don't hold a persistent socket open.
 * Every action in the app already bumps a refresh key after it lands,
 * so balances still update; they just don't push from an external
 * change made outside this tab. Acceptable for a devnet rehearsal.
 */

export const config = { runtime: "edge" };

export default async function handler(req: Request): Promise<Response> {
  const endpoint = process.env.RPC_ENDPOINT;
  if (!endpoint) {
    return json(500, { error: "RPC_ENDPOINT is not set on the server" });
  }
  if (req.method !== "POST") {
    return json(405, { error: "POST only" });
  }

  try {
    const body = await req.text();
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    const text = await res.text();
    return new Response(text, {
      status: res.status,
      headers: { "content-type": "application/json" },
    });
  } catch (e) {
    return json(502, { error: `rpc unreachable: ${String(e)}` });
  }
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
