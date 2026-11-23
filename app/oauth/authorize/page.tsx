import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getT } from "@/lib/lang";
import type { T } from "@/lib/i18n";
import type { OAuthClient } from "@/lib/repositories/oauth-clients";
import { checkAuthorization } from "@/lib/services/oauth-server";
import type { AuthorizeQuery, AuthorizeRequest } from "@/lib/services/oauth-rules";
import { currentUser } from "@/lib/session";
import { AuthShell } from "../../features/auth-shell";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

const PARAMS = [
  "client_id",
  "redirect_uri",
  "response_type",
  "code_challenge",
  "code_challenge_method",
  "state",
  "resource",
  "scope",
] as const;

const first = (value: string | string[] | undefined): string | null =>
  (Array.isArray(value) ? value[0] : value) ?? null;

function readQuery(asked: Record<string, string | string[] | undefined>): AuthorizeQuery {
  return Object.fromEntries(PARAMS.map((key) => [key, first(asked[key])])) as AuthorizeQuery;
}

/** This page's own address with the same query, for the trip through sign-in. */
function selfPath(query: AuthorizeQuery): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value) search.set(key, value);
  return `/oauth/authorize?${search.toString()}`;
}

/**
 * An agent asking to connect.
 *
 * Signed out, the visitor signs in first and comes back here. Signed in, they
 * see who is asking and where the answer goes, and decide. The decision posts
 * to `/api/oauth/authorize`, which checks everything again: nothing on this
 * page is trusted by the handler that acts on it.
 */
export default async function AuthorizePage({ searchParams }: PageProps<"/oauth/authorize">) {
  const query = readQuery(await searchParams);
  const user = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(selfPath(query))}`);

  const { t } = await getT();
  const outcome = await checkAuthorization(query);
  if (outcome.kind === "redirect") redirect(outcome.url);
  if (outcome.kind === "invalid")
    return (
      <AuthShell
        mood="puzzled"
        title={t("oauthInvalidTitle")}
        intro={t("oauthInvalidBody", { reason: outcome.description })}
      />
    );

  const { client, request } = outcome;
  return (
    <AuthShell
      title={t("oauthConsentTitle", { client: client.client_name })}
      intro={t("oauthConsentIntro", { client: client.client_name })}
    >
      <ClientFacts client={client} request={request} t={t} />
      <p className="mt-4 text-small text-muted">{t("oauthConsentSignedIn", { name: user.name || user.username })}</p>
      <ConsentForm request={request} t={t} />
    </AuthShell>
  );
}

/** How todox knows this client, said in words, plus where the browser goes next. */
function ClientFacts({
  client,
  request,
  t,
}: {
  client: OAuthClient;
  request: AuthorizeRequest;
  t: T;
}): React.JSX.Element {
  const provenance =
    client.kind === "cimd"
      ? t("oauthConsentVerified", { host: new URL(client.client_id).host })
      : client.kind === "first_party"
        ? t("oauthConsentFirstParty")
        : t("oauthConsentRegistered");
  const destination = new URL(request.redirect_uri);
  const shownDestination =
    destination.protocol === "http:" || destination.protocol === "https:"
      ? destination.host
      : `${destination.protocol}//${destination.host}`;
  return (
    <div className="flex flex-col gap-3 text-[14px] leading-snug">
      <p>{t("oauthConsentWhat")}</p>
      <p className="text-muted">{provenance}</p>
      <p className="text-muted">
        {t("oauthConsentReturn")} <code className="break-all">{shownDestination}</code>
      </p>
    </div>
  );
}

/** The request travels as hidden fields; the handler re-validates all of it. */
function ConsentForm({ request, t }: { request: AuthorizeRequest; t: T }): React.JSX.Element {
  const fields: Record<string, string> = {
    client_id: request.client_id,
    redirect_uri: request.redirect_uri,
    response_type: "code",
    code_challenge: request.code_challenge,
    code_challenge_method: "S256",
    resource: request.resource,
    ...(request.state ? { state: request.state } : {}),
  };
  return (
    <form method="post" action="/api/oauth/authorize" className="mt-5 flex flex-wrap gap-3">
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <button type="submit" name="decision" value="allow" className="btn flex-1">
        {t("oauthAllow")}
      </button>
      <button type="submit" name="decision" value="deny" className="btn-quiet flex-1">
        {t("oauthDeny")}
      </button>
    </form>
  );
}
