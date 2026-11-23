import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import { hostname } from "node:os";

import { HOSTED_URL } from "./hook/config";
import { saveCredentials } from "./saved-config";

/**
 * `todox-mcp login`: sign this machine in through the browser.
 *
 * The hooks, the stdio server and the git hook run here and need a token of
 * their own -- the agent's OAuth token stays inside the agent. This is the
 * RFC 8252 loopback flow every CLI uses (`gh auth login`, `gcloud auth
 * login`): listen on 127.0.0.1, send the browser to the consent page, take the
 * code that comes back, trade it for a token, save it owner-only. Nothing is
 * copied or pasted, and nothing lands in a shell history.
 */

export const CLIENT_ID = "todox-cli";
const WAIT_MS = 5 * 60_000;

type Env = Record<string, string | undefined>;

export interface Pkce {
  verifier: string;
  challenge: string;
}

export function newPkce(): Pkce {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

export function authorizeUrl(input: {
  server: string;
  redirectUri: string;
  challenge: string;
  state: string;
}): string {
  const url = new URL("/oauth/authorize", input.server);
  url.search = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: input.redirectUri,
    response_type: "code",
    code_challenge: input.challenge,
    code_challenge_method: "S256",
    state: input.state,
    resource: `${input.server}/api/mcp`,
  }).toString();
  return url.toString();
}

/** `--url <server>` if given, else the environment, else the hosted server. */
export function serverFrom(args: string[], env: Env): string {
  const index = args.indexOf("--url");
  const given = index >= 0 ? args[index + 1] : undefined;
  return (given || env.TODOX_URL || HOSTED_URL).replace(/\/+$/, "");
}

/**
 * Best effort. The URL is always printed as well, because on a machine with
 * no default browser -- or over SSH -- this does nothing useful and must not
 * be the only way through.
 */
function openBrowser(url: string): void {
  const [command, args] =
    process.platform === "win32"
      ? ["cmd", ["/c", "start", "", url.replace(/&/g, "^&")]]
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  const child = spawn(command, args, { stdio: "ignore", detached: true });
  child.on("error", (error) => console.error(`[todox] could not open a browser: ${error.message}`));
  child.unref();
}

const PAGE = (message: string) =>
  `<!doctype html><meta charset="utf-8"><title>todox</title><body style="font:16px system-ui;margin:20vh auto;max-width:28rem;padding:0 16px">${message}</body>`;

/** The code from the one callback that carries our state, or an error. */
function awaitCallback(server: Server, state: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("no answer from the browser in 5 minutes")), WAIT_MS);
    server.on("request", (req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== "/callback") {
        res.writeHead(404).end();
        return;
      }
      const done = (status: number, message: string) => {
        res.writeHead(status, { "content-type": "text/html; charset=utf-8" }).end(PAGE(message));
      };
      if (url.searchParams.get("state") !== state) {
        done(400, "This sign-in link is not the one this terminal started. Run the login again.");
        return;
      }
      clearTimeout(timer);
      const error = url.searchParams.get("error");
      const code = url.searchParams.get("code");
      if (error || !code) {
        done(400, "Sign-in was not completed. You can close this tab.");
        reject(new Error(error === "access_denied" ? "the request was declined" : (error ?? "no code returned")));
        return;
      }
      done(200, "Signed in. You can close this tab and go back to the terminal.");
      resolve(code);
    });
  });
}

async function exchange(input: {
  server: string;
  code: string;
  verifier: string;
  redirectUri: string;
}): Promise<string> {
  const res = await fetch(`${input.server}/api/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: input.code,
      code_verifier: input.verifier,
      client_id: CLIENT_ID,
      redirect_uri: input.redirectUri,
      device_name: hostname(),
    }),
  });
  const body = (await res.json()) as { access_token?: string; error_description?: string };
  if (!res.ok || !body.access_token)
    throw new Error(`the server refused the sign-in: ${body.error_description ?? res.status}`);
  return body.access_token;
}

const listen = (server: Server): Promise<number> =>
  new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address === "object") resolve(address.port);
      else reject(new Error("could not bind a local port"));
    });
  });

export async function runLogin(args: string[], env: Env): Promise<number> {
  const server = serverFrom(args, env);
  const pkce = newPkce();
  const state = randomBytes(16).toString("base64url");
  const listener = createServer();
  try {
    const port = await listen(listener);
    const redirectUri = `http://127.0.0.1:${port}/callback`;
    const url = authorizeUrl({ server, redirectUri, challenge: pkce.challenge, state });
    console.log(`Opening your browser to sign in to ${server}.`);
    console.log(`If it does not open, visit:\n\n  ${url}\n`);
    if (!args.includes("--no-browser")) openBrowser(url);

    const code = await awaitCallback(listener, state);
    const token = await exchange({ server, code, verifier: pkce.verifier, redirectUri });
    const path = saveCredentials(env, { token, url: server === HOSTED_URL ? undefined : server });
    console.log(`Signed in. Saved to ${path} (readable by you only).`);
    console.log("The hooks, the stdio server and the git hook on this machine will use it.");
    return 0;
  } catch (e) {
    console.error(`[todox] login: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  } finally {
    await stop(listener);
  }
}

/**
 * Closed and waited for before the caller's `process.exit`: on Windows,
 * exiting while the listener is still closing trips a libuv assertion and the
 * process dies with a crash code after a login that had succeeded.
 */
function stop(server: Server): Promise<void> {
  server.closeAllConnections();
  return new Promise((resolve) => server.close(() => resolve()));
}
