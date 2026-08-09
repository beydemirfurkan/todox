# Security

todox holds people's working notes and issues tokens that let an agent read and
write them, so the auth surface matters more than the feature list.

## Reporting something

Open a [private security advisory](https://github.com/beydemirfurkan/todox/security/advisories/new).
Please do not open a public issue for anything that lets one account reach
another's data, or that bypasses authentication.

There is no bounty. There will be a quick, honest answer.

## What the design guarantees

- **Ownership is checked in one place.** `lib/services/ownership.ts` is the only
  authority on "does this row belong to this account". Ids arrive from URLs,
  form fields and MCP arguments, so every write path proves ownership first.
- **Foreign rows answer 404, not 403.** Ids cannot be probed for existence.
- **Nothing sensitive is stored in the clear.** Passwords are scrypt; sessions,
  agent tokens and email links are stored as SHA-256 hashes only.
- **Password reset does not reveal whether an address is registered.** The
  response is identical either way, and a delivery failure never changes it.
- **A password reset destroys every session and every agent token.** It is the
  recovery path, so it assumes you lost control of the account; a token that
  never expires and carries full permissions is what an intruder would keep.
- **Changing the email costs the current password**, and the previous address
  is told. Without that gate a stolen session cookie was permanent ownership:
  point the account at an address you control, then run the reset flow.
- **Parameters are validated before they reach the data layer.**
  `lib/services/rpc-schemas.ts` is the runtime contract for every RPC method,
  and repositories build `SET` clauses from a column allow-list, never from the
  caller's own keys.
- **Rate limits live in the database**, so they hold across instances rather
  than per process. Login counts failures only.
- **The proxy is not the gate.** `proxy.ts` redirects on a missing cookie for
  UX; the real check is `requireUser()` at the data boundary.

`pnpm smoke:auth` asserts most of the above. If you change auth, run it.

## What it does not do

These are known and documented, not oversights:

- No two-factor authentication.
- No per-session revocation list — changing your password ends all sessions,
  but you cannot end one device from another.
- No audit log.
- Share links (`/s/<token>`) are unlisted, not access-controlled. Anyone with
  the URL can read the shared task list. Rotate or disable the link to revoke.
- Agent tokens carry the full permissions of the account that created them.
  There are no scopes and no expiry. A password *reset* revokes them all;
  a deliberate password *change* does not, on the grounds that you still had
  the old password, so use "revoke every token" on the Account page when that
  is what you actually mean.

## Running it yourself

- Set `TODOX_PUBLIC_URL` to the real origin. Verification and reset links are
  built from it, and a wrong value sends people somewhere else.
- Serve over HTTPS. Session cookies are marked `secure` in production, and
  without TLS they will not be sent at all.
- `pnpm seed` refuses to create the demo account when `NODE_ENV=production`,
  because its password is published in this repository.
