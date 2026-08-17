/**
 * Who to hold responsible for a request, for rate limiting.
 *
 * `x-forwarded-for` is a list that grows left to right, and only the right-hand
 * end of it is ours. Each proxy appends the address it received the connection
 * from, so the last entry was written by the proxy nearest us and everything
 * further left was written by whoever was further out -- including, at the very
 * left, whatever the client sent. Reading `[0]` therefore reads a value the
 * caller chose. That is how this was written, and it means the brute-force gate
 * on bad tokens and the per-IP login and register limits could all be split
 * across as many buckets as an attacker cared to invent.
 *
 * So: count from the right, one step per proxy we actually run behind.
 *
 * The count is configuration because it is a fact about the deployment, not
 * about the code. Behind one reverse proxy it is 1. Behind a CDN as well it is
 * 2, because the CDN appends the client and the proxy then appends the CDN.
 *
 * Getting it wrong is deliberately lopsided. Set it too LOW and you land on a
 * proxy's own address: everyone behind that hop shares a bucket, which is
 * coarse and annoying and not exploitable. Set it too HIGH and you reach past
 * the trusted hops into the part of the list the client wrote, which is the
 * bug this file exists to remove. The default is therefore the lowest useful
 * value, and a chain shorter than the configured count answers `unknown`
 * rather than guessing -- the same failure direction as too low.
 */

const DEFAULT_HOPS = 1;

/** No proxy at all, and no header to read: everyone shares this bucket. */
const UNKNOWN = "unknown";

/**
 * How many proxies sit between the internet and this process.
 *
 * Zero is meaningful and not the same as unset: it says nothing forwards to us,
 * so every forwarding header arrived from the caller and none of them may be
 * read. A process exposed straight to the internet is the one case where the
 * default would otherwise be wrong in the dangerous direction -- it would trust
 * one hop that is not there.
 *
 * Anything unparseable or negative means the default, because a value nobody
 * can be sure of must not be allowed to widen what we trust.
 */
function trustedHops(): number {
  const raw = process.env.TRUSTED_PROXY_HOPS;
  if (raw === undefined || raw.trim() === "") return DEFAULT_HOPS;
  const configured = Number(raw);
  if (!Number.isInteger(configured) || configured < 0) return DEFAULT_HOPS;
  return configured;
}

/**
 * Only `get` is read here, and the callers do not agree on a type: a route
 * handler has a real `Headers`, `next/headers` hands back a read-only view of
 * one. Asking for the narrowest thing this needs lets both pass without an
 * assertion at either call site.
 */
type Readable = Pick<Headers, "get">;

export function clientIp(headers: Readable): string {
  const hops = trustedHops();
  // Nothing in front of us: every forwarding header is the caller's to write,
  // so there is no address here to tell anyone apart by.
  if (hops === 0) return UNKNOWN;

  const chain = (headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  // `>=`, not `>`: with one proxy and one entry, that entry is the client.
  if (chain.length >= hops) return chain[chain.length - hops]!;

  // Fewer entries than proxies we were told to expect. One of the two is
  // wrong, and there is no way from here to tell which -- a single entry may
  // be a proxy that appended honestly or a client that made one up. Both
  // readings are unsafe to act on, so neither is acted on.
  return headers.get("x-real-ip")?.trim() || UNKNOWN;
}
