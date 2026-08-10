import Link from "next/link";

import { getT } from "@/lib/lang";
import { AuthShell } from "./features/auth-shell";

/**
 * A 404 that looks like the rest of the app.
 *
 * There was no `not-found.tsx` at all, so `notFound()` fell through to Next's
 * own bare page — and, worse, the places that should have called it threw
 * instead: a stale `?project=` on the report page reached the user as
 * "Application error: a server-side exception has occurred".
 */
export default async function NotFound() {
  const { t } = await getT();

  return (
    <AuthShell
      mood="worried"
      fill="var(--k-question)"
      title={t("notFoundTitle")}
      intro={t("notFoundBody")}
    >
      <Link href="/" className="btn block text-center">
        {t("backHome")}
      </Link>
    </AuthShell>
  );
}
