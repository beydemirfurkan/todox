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
    <div className="mb-5 flex flex-col gap-2.5">
      {providers.map((provider) => (
        <a key={provider} href={`/api/auth/${provider}/start${query}`} className="oauth-button">
          {provider === "google" ? <GoogleMark /> : <GitHubMark />}
          {provider === "google" ? t("oauthContinueGoogle") : t("oauthContinueGithub")}
        </a>
      ))}
      <p className="oauth-divider">
        <span>{t("oauthOr")}</span>
      </p>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24">
      <path fill="#4285F4" d="M23.5 12.27c0-.82-.07-1.6-.2-2.36H12v4.47h6.45a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.57-5.17 3.57-8.73Z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.94-2.9l-3.88-3c-1.08.72-2.45 1.15-4.06 1.15-3.12 0-5.77-2.11-6.71-4.95H1.28v3.1A12 12 0 0 0 12 24Z" />
      <path fill="#FBBC05" d="M5.29 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.28a12 12 0 0 0 0 10.8l4.01-3.1Z" />
      <path fill="#EA4335" d="M12 4.75c1.76 0 3.34.6 4.58 1.8l3.44-3.44A11.97 11.97 0 0 0 12 0 12 12 0 0 0 1.28 6.6l4.01 3.1C6.23 6.86 8.88 4.75 12 4.75Z" />
    </svg>
  );
}

function GitHubMark() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56v-2c-3.2.7-3.87-1.37-3.87-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.03 1.76 2.69 1.25 3.35.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.18-3.1-.12-.29-.51-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.18 1.84 1.18 3.1 0 4.42-2.69 5.39-5.26 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.68.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
    </svg>
  );
}
