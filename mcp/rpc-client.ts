/**
 * Thin transport to the todox server. The MCP process runs on the developer's
 * machine; the data lives wherever todox is hosted, so everything goes over
 * HTTP with the user's API token.
 */
export class RpcError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "RpcError";
  }
}

export type RpcClient = (method: string, params?: unknown) => Promise<unknown>;

export function createClient(baseUrl: string, token: string): RpcClient {
  const endpoint = new URL("/api/rpc", baseUrl).toString();

  return async (method, params) => {
    let res: Response;
    try {
      res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ method, params: params ?? {} }),
      });
    } catch (e) {
      throw new RpcError(
        `cannot reach todox at ${endpoint} (${(e as Error).message}). Is the server running?`,
        0,
      );
    }

    const body = (await res.json().catch(() => null)) as
      | { ok: true; result: unknown }
      | { ok: false; error: string }
      | null;

    if (!body) throw new RpcError(`todox returned ${res.status} with no JSON body`, res.status);
    if (!body.ok) throw new RpcError(body.error, res.status);
    return body.result;
  };
}

export function readConfig() {
  const token = process.env.TODOX_TOKEN;
  const url = process.env.TODOX_URL ?? "http://localhost:3000";
  if (!token) {
    throw new Error(
      "TODOX_TOKEN is not set. Create an agent token on the Account page and pass it " +
        "to this process in the environment. Most people do not need this mode at " +
        "all: the hosted server at /api/mcp needs no local process.",
    );
  }
  return { token, url };
}
