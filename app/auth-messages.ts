import type { Key, T } from "@/lib/i18n";
import type { FieldError } from "@/lib/services/auth";

/** Every validation code the auth service can emit, resolved on the server. */
const CODES = [
  "usernameFormat",
  "emailFormat",
  "nameRequired",
  "passwordShort",
  "usernameTaken",
  "emailTaken",
  "badCredentials",
  "tooManyAttempts",
  "linkInvalid",
  "confirmMismatch",
] as const;

export function authMessages(t: T): Record<string, string> {
  return Object.fromEntries(CODES.map((c) => [c, t(`err_${c}` as Key)]));
}

/**
 * Some messages carry a number (how long a lockout lasts). Interpolation has
 * to happen where `t` lives, so the client component only ever sees finished
 * strings.
 */
export function formatError(t: T, e: FieldError): string {
  return t(`err_${e.code}` as Key, e.retryAfterSec ? { n: e.retryAfterSec } : undefined);
}
