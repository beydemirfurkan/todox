import { createHash, randomBytes } from "node:crypto";

/**
 * Session and API secrets are random, opaque and never stored in the clear --
 * only their SHA-256. Losing the database must not mean losing every live
 * session and every agent's credentials.
 */

export { SESSION_COOKIE } from "../cookies";
export const SESSION_DAYS = 30;
export const API_TOKEN_PREFIX = "todox_";

export const newSessionToken = () => randomBytes(32).toString("base64url");

export const newApiToken = () =>
  `${API_TOKEN_PREFIX}${randomBytes(24).toString("base64url")}`;

export const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

/** Enough to recognise a token in a list without being enough to use it. */
export const tokenPreview = (token: string) =>
  `${token.slice(0, API_TOKEN_PREFIX.length + 4)}…${token.slice(-4)}`;
