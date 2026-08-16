import { logError } from "../server/log";
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/**
 * scrypt from node:crypto. No native dependency, no third-party library, and
 * memory-hard in a way plain PBKDF2 is not. Parameters are stored alongside
 * the hash so they can be raised later without invalidating old passwords.
 */
const PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEYLEN = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, KEYLEN, PARAMS);
  return [
    "scrypt",
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString("base64"),
    derived.toString("base64"),
  ].join("$");
}

/**
 * A record this cannot read is a credential this cannot verify, which is not
 * the same as a credential that matched -- so every unreadable form answers
 * false rather than throwing.
 *
 * It used to throw. A record missing its salt or hash reached
 * `Buffer.from(undefined, "base64")`, and a non-numeric cost parameter reached
 * scrypt, both of which reject. That matters beyond tidiness because `login`
 * verifies against a fixed dummy record when no account matches, purely so the
 * two paths take the same time: if that record were ever mistyped, an unknown
 * account would answer 500 while a wrong password answered 401, and the pair
 * would be an account-enumeration oracle.
 */
export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const [scheme, n, r, p, saltB64, hashB64] = stored.split("$");
  if (scheme !== "scrypt") return false;
  if (!n || !r || !p || !saltB64 || !hashB64) return false;

  const cost = { N: Number(n), r: Number(r), p: Number(p) };
  if (!Object.values(cost).every((v) => Number.isInteger(v) && v > 0)) return false;

  const salt = Buffer.from(saltB64, "base64");
  const expected = Buffer.from(hashB64, "base64");
  if (expected.length === 0) return false;

  let derived: Buffer;
  try {
    derived = await scrypt(password, salt, expected.length, {
      ...cost,
      maxmem: PARAMS.maxmem,
    });
  } catch (e) {
    // Cost parameters out of range, or over maxmem. Logged because a stored
    // record that cannot be derived from is data corruption worth seeing --
    // never with the password or the record itself.
    logError("password.unusableRecord", e);
    return false;
  }

  // constant time: a length mismatch must not short-circuit either
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}
