/**
 * Mark one account's email as verified, for an instance with no SMTP.
 *
 * Without mail nobody can click a verification link, and an unverified address
 * cannot invite anyone or turn on sharing. On a self-hosted instance the
 * person running the server is the one vouching for the address, so this is
 * that act, done deliberately from the server and for one account at a time.
 *
 *   pnpm user:verify you@example.com
 *   docker compose exec app pnpm user:verify you@example.com
 */
import "./env";

import * as usersRepo from "../lib/repositories/users";

async function main(): Promise<void> {
  const email = process.argv[2]?.trim();
  if (!email) {
    console.error("usage: pnpm user:verify <email>");
    process.exit(1);
  }

  const user = await usersRepo.byEmail(email);
  if (!user) {
    console.error(`no account with that email`);
    process.exit(1);
  }

  await usersRepo.markEmailVerified(user.id);
  console.log(`verified: ${user.username}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
