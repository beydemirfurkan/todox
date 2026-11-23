import Image from "next/image";

import type { T } from "@/lib/i18n";
import type { OAuthProvider } from "@/lib/repositories/oauth-accounts";

/**
 * "Continue with Google / GitHub", above the email form. Links rather than
 * form buttons: the trip leaves this origin, and the CSP only lets forms post
 * to this one. Absent entirely when no provider is configured, so a
 * self-hosted instance without keys shows the form it always showed.
 */
export function OAuthButtons({
  providers,
  next,
  t,
}: {
  providers: OAuthProvider[];
  /** Where to land afterwards; only an allow-listed path survives the trip. */
  next?: string;
  t: T;
}) {
  if (providers.length === 0) return null;
  const query = next ? `?next=${encodeURIComponent(next)}` : "";
  return (
    <div className="flex flex-col gap-2.5">
      {providers.map((provider) => (
        <a key={provider} href={`/api/auth/${provider}/start${query}`} className="oauth-button">
          <Image src={`/icons/${provider}.svg`} alt="" width={18} height={18} />
          {provider === "google" ? t("oauthContinueGoogle") : t("oauthContinueGithub")}
        </a>
      ))}
    </div>
  );
}
