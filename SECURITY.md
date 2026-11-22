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
  response is identical either way, a delivery failure never changes it, and
  the link and the mail are prepared after the answer so the timing is the
  same too. Registration does say when an address is taken; see below.
- **A password reset destroys every session, every agent token and every
  connected Google or GitHub sign-in.** It is the recovery path, so it assumes
  you lost control of the account; anything an intruder could have added to
  get back in goes with it.
- **Changing the email costs the current password**, ends every other session,
  retires any reset or verification link already sent, and the previous
  address is told. Without the password a stolen session cookie was permanent
  ownership; without retiring the links, a reset sent to the old address
  would mark the new one verified.
- **Connecting Google or GitHub costs the password** (or, for an account
  without one, a sign-in in the last fifteen minutes), and the account's
  address is told every time. A connected sign-in is a way in that survives a
  password change, so a session cookie alone must not be able to add one.
  Connecting does not open a new session, so it cannot stand in for a recent
  sign-in either.
- **Signing in with Google or GitHub never joins an account whose address was
  not verified while somebody else may still hold its password.** If the
  provider has verified the address and the account never did, the account is
  handed over clean: its password, sessions and agent tokens are removed.
- **Invitations need a verified address**, and the project name is clipped in
  the subject, so mail from this domain cannot be sent by an unproved account
  or used to carry a message.
- **Deleting the account costs the current password too**, and the username as
  a second, deliberate step. It is irreversible and takes every project, task,
  entry, ref, context, session and agent token with it, by cascade from the
  user row.
- **Mail goes out over authenticated SMTP with STARTTLS required.** The
  connection is refused rather than downgraded if the server will not upgrade,
  so the mailbox password is never sent in the clear. A delivery failure is
  still swallowed on purpose (see above) and logged with the address masked.
- **Parameters are validated before they reach the data layer.**
  `lib/services/rpc-schemas.ts` is the runtime contract for every RPC method,
  and repositories build `SET` clauses from a column allow-list, never from the
  caller's own keys.
- **Rate limits live in the database**, so they hold across instances rather
  than per process. Password checks are counted before the hash runs, so a
  burst of parallel guesses cannot all slip under the limit; a successful login
  gives back its own count.
- **A project's notes can be changed only by their author or the project's
  owner.** They are the standing rules the owner's agents are briefed with.
- **The local MCP process will not hash private files for a shared project:**
  hidden directories in the home folder (other than the agents' own), key and
  `.env` files, and anything over 20 MB are reported as unknown instead.
- **Agent endpoints read at most 4 MB of body, chunked or not, and take one
  JSON-RPC message per request.**
- **The proxy is not the gate.** `proxy.ts` redirects on a missing cookie for
  UX; the real check is `requireUser()` at the data boundary.

`pnpm smoke:auth` asserts most of the above. If you change auth, run it.

## What it does not do

These are known and documented, not oversights:

- Registration says when a username or an address is already taken. That
  answers whether an address has an account, limited to five attempts an hour
  per network address; a sign-up that never says so is a worse sign-up.
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
- A token used with a remote agent ends up in that agent's configuration file,
  and if you use the paste-this-to-your-agent route, in its transcript too.
  That is the cost of a setup step nobody gets wrong; treat a token as
  something the tools you paste it into can see.
- If the mail provider's sending limit is reached, messages are dropped. It
  cannot leak whether an address is registered — the response is identical
  either way — but the only place it shows up is the server log.
- The Content-Security-Policy allows inline scripts (`script-src` carries
  `'unsafe-inline'`). Nothing in the app emits a nonce, so that directive means
  what it says and the CSP is not a second line of defence against an injected
  script — escaping and `react-markdown`'s `skipHtml` are the first and, for
  now, only one. Closing it means minting a nonce per request in `proxy.ts`,
  which changes how every page loads its scripts and is not done yet.

## Running it yourself

- Set `TODOX_PUBLIC_URL` to the real origin. Verification and reset links are
  built from it, and a wrong value sends people somewhere else.
- Serve over HTTPS. Session cookies are marked `secure` in production, and
  without TLS they will not be sent at all.
- `pnpm seed` refuses to create the demo account when `NODE_ENV=production`,
  because its password is published in this repository.
