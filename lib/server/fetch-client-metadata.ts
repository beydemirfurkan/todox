import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import { logWarn } from "./log";

/**
 * Fetching a client's metadata document (CIMD).
 *
 * The one place this server makes a request to a URL a stranger chose: the
 * `client_id` of an authorisation request is that URL. So it is a server-side
 * request forgery surface by construction, and everything here is about
 * keeping it a fetch of a small public JSON file and nothing else -- https
 * only, public addresses only, no redirects, a few kilobytes, a few seconds.
 *
 * The address check runs on the resolved IPs before the fetch, which leaves a
 * DNS-rebinding window between the two lookups. What sits behind it is a JSON
 * parse of at most 5 KB whose content is only accepted if it names itself by
 * the URL asked for, so a rebound answer can be read by nobody.
 */

const MAX_BYTES = 5 * 1024;
const TIMEOUT_MS = 3_000;

const v4Parts = (ip: string): number[] => ip.split(".").map(Number);

function isPublicV4(ip: string): boolean {
  const [a, b] = v4Parts(ip);
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false; // carrier-grade NAT
  if (a === 169 && b === 254) return false; // link-local, cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && (b === 168 || b === 0)) return false;
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
  return true;
}

function isPublicV6(ip: string): boolean {
  const lower = ip.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (mapped) return isPublicV4(mapped[1]);
  if (lower === "::" || lower === "::1") return false;
  // Unique-local, link-local, multicast, NAT64 -- none of them is the internet.
  return !/^(f[cd]|fe[89ab]|ff|64:ff9b:)/.test(lower);
}

/** Whether an address is somewhere on the public internet. */
export function isPublicAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return isPublicV4(ip);
  if (family === 6) return isPublicV6(ip);
  return false;
}

async function resolvesPublicly(hostname: string): Promise<boolean> {
  const bare = hostname.replace(/^\[|\]$/g, "");
  if (isIP(bare)) return isPublicAddress(bare);
  const addresses = await lookup(bare, { all: true, verbatim: true });
  return addresses.length > 0 && addresses.every((a) => isPublicAddress(a.address));
}

/** The body, or null once it grows past the cap -- read in chunks, never whole. */
async function readCapped(res: Response): Promise<string | null> {
  if (!res.body) return null;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * The parsed document at `url`, or null for anything short of a small JSON
 * object served over https from a public address. Null is logged with the
 * reason and never the body: the URL is the client's, the body is theirs too.
 */
export async function fetchClientMetadata(url: string): Promise<unknown> {
  const target = new URL(url);
  if (target.protocol !== "https:") return null;
  try {
    if (!(await resolvesPublicly(target.hostname))) {
      logWarn("oauth.cimd.refused", { reason: "non-public address", host: target.host });
      return null;
    }
    const res = await fetch(target, {
      redirect: "error",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      logWarn("oauth.cimd.refused", { reason: `status ${res.status}`, host: target.host });
      return null;
    }
    const text = await readCapped(res);
    if (text === null) {
      logWarn("oauth.cimd.refused", { reason: "too large", host: target.host });
      return null;
    }
    return JSON.parse(text) as unknown;
  } catch (error) {
    logWarn("oauth.cimd.failed", {
      host: target.host,
      reason: error instanceof Error ? error.name : "unknown",
    });
    return null;
  }
}
