export { Session } from "./session.ts";
export { CredentialVault } from "./credentials.ts";

const json = (body: unknown, status: number, headers?: HeadersInit): Response =>
  Response.json(body, { status, headers });

const sessionSocketRoute = /^\/api\/sessions\/([^/]+)\/?$/;

/** Constant-time comparison for a shared bearer token. */
function sameToken(actual: string, expected: string): boolean {
  if (actual.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < actual.length; index += 1) {
    difference |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return difference === 0;
}

/**
 * `PI_DURABLE_TOKEN` gates the API when set. Browsers cannot set headers on a
 * WebSocket handshake, so the socket accepts the same token as `?token=`.
 * Leave it unset only behind an edge that authenticates every request
 * (Cloudflare Access or equivalent).
 */
function authorized(request: Request, env: Env): boolean {
  const expected = env.PI_DURABLE_TOKEN;
  if (expected === undefined || expected.length === 0) return true;
  const header = request.headers.get("Authorization");
  if (header?.startsWith("Bearer ") === true) {
    return sameToken(header.slice("Bearer ".length), expected);
  }
  const url = new URL(request.url);
  const query = url.searchParams.get("token");
  return query !== null && sameToken(query, expected);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      if (!authorized(request, env)) {
        return json({ error: "Unauthorized" }, 401, {
          "WWW-Authenticate": "Bearer",
        });
      }
    }

    if (url.pathname === "/api/sessions" || url.pathname === "/api/sessions/") {
      if (request.method !== "POST") {
        return json({ error: "Method not allowed" }, 405, { Allow: "POST" });
      }
      const sessionId = crypto.randomUUID();
      return json({ sessionId, url: `/sessions/${sessionId}` }, 201);
    }

    const sessionMatch = sessionSocketRoute.exec(url.pathname);
    if (sessionMatch !== null) {
      if (request.method !== "GET") {
        return json({ error: "Method not allowed" }, 405, { Allow: "GET" });
      }
      if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
        return json({ error: "WebSocket upgrade required" }, 426, { Upgrade: "websocket" });
      }
      return env.SESSIONS.getByName(sessionMatch[1]).fetch(request);
    }

    return json({ error: "Not found" }, 404);
  },
} satisfies ExportedHandler<Env>;
