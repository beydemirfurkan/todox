import { API_TOKEN_PREFIX } from "../util/tokens";

/**
 * The agent token out of an `Authorization` header, or "" when there is none.
 *
 * `Bearer todox_…` is the documented form and what every snippet writes. The
 * bare form -- `Authorization: todox_…` -- is accepted too, for a gateway
 * that forwards a configured value as the whole header and cannot put a
 * scheme in front of it (Smithery's does exactly that). Nothing is lost: the
 * token's own prefix already says what it is, and a header that carries
 * neither the scheme nor the prefix is refused as before.
 *
 * One function for the three routes that used to parse this inline, so the
 * bare form cannot be accepted by one surface and refused by another.
 */
export function bearerToken(headers: Headers): string {
  const auth = (headers.get("authorization") ?? "").trim();
  if (auth.startsWith("Bearer ")) return auth.slice(7).trim();
  if (auth.startsWith(API_TOKEN_PREFIX)) return auth;
  return "";
}
