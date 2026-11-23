/**
 * Response shapes shared by the OAuth endpoints.
 *
 * Every one of them is called by a client, never by a page of ours, and some
 * of those clients run in a browser on another origin (an MCP inspector, a
 * web-based agent). None of them uses a cookie, so allowing any origin hands
 * nothing to a page that it could not already ask for from a server.
 */
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "authorization, content-type, mcp-protocol-version",
};

export function oauthJson(body: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      // A token response cached anywhere is a token handed to the next reader.
      "cache-control": "no-store",
      ...CORS,
      ...headers,
    },
  });
}

export const oauthError = (status: number, error: string, description: string): Response =>
  oauthJson({ error, error_description: description }, status);

export const preflight = (): Response => new Response(null, { status: 204, headers: CORS });

/**
 * The parameters of a token or revocation request. The RFCs say
 * form-encoded; a few clients send JSON anyway, and refusing them helps
 * nobody.
 */
export async function readParams(req: Request): Promise<Record<string, string>> {
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    const body: unknown = await req.json();
    if (!body || typeof body !== "object") return {};
    return Object.fromEntries(
      Object.entries(body as Record<string, unknown>).filter(
        (pair): pair is [string, string] => typeof pair[1] === "string",
      ),
    );
  }
  const form = new URLSearchParams(await req.text());
  return Object.fromEntries(form.entries());
}
