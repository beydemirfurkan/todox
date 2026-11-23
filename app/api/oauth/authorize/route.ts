import { getT } from "@/lib/lang";
import { publicUrl } from "@/lib/public-url";
import { logWarn } from "@/lib/server/log";
import { approve, checkAuthorization, deny } from "@/lib/services/oauth-server";
import { siteOrigins, type AuthorizeQuery } from "@/lib/services/oauth-rules";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * Hands the browser back to the client.
 *
 * A page rather than a 303: the consent form posts here under the site's
 * `form-action 'self'`, and browsers apply that directive to every redirect a
 * form submission follows -- so a 303 to the client's loopback listener, or to
 * `cursor://`, would be blocked after the person had already said yes. A
 * meta refresh is a navigation, not a form target, and the button is there
 * for a browser that asks before opening an app.
 */
async function handBack(url: string): Promise<Response> {
  const { t } = await getT();
  const href = escapeHtml(url);
  const html = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta http-equiv="refresh" content="0;url=${href}">
<title>${escapeHtml(t("oauthReturningTitle"))}</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:28rem;margin:15vh auto;padding:0 16px;color:#e8e6e3;background:#141414}a{display:inline-block;margin-top:1rem;padding:.6rem 1.2rem;border-radius:999px;background:#e8e6e3;color:#141414;text-decoration:none}</style>
</head><body><h1>${escapeHtml(t("oauthReturningTitle"))}</h1>
<p>${escapeHtml(t("oauthReturningBody"))}</p>
<a href="${href}">${escapeHtml(t("oauthReturningCta"))}</a></body></html>`;
  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
    },
  });
}

const refuse = (status: number, message: string): Response =>
  new Response(message, { status, headers: { "content-type": "text/plain; charset=utf-8" } });

const field = (form: FormData, key: string): string | null => {
  const value = form.get(key);
  return typeof value === "string" ? value : null;
};

/**
 * The consent decision.
 *
 * Two things stop a page elsewhere from approving on somebody's behalf: the
 * session cookie is SameSite=Lax, so a cross-site POST arrives without it, and
 * the Origin header has to be this site's. Then the whole request is checked
 * again from the posted fields, exactly as the consent page checked it.
 */
export async function POST(req: Request): Promise<Response> {
  if (!siteOrigins(publicUrl()).includes(req.headers.get("origin") ?? "")) {
    logWarn("oauth.authorize.crossOrigin", { origin: req.headers.get("origin") ?? "none" });
    return refuse(403, "cross-origin request refused");
  }
  const user = await currentUser();
  if (!user) return refuse(401, "sign in and start again from your agent");

  const form = await req.formData();
  const query: AuthorizeQuery = {
    client_id: field(form, "client_id"),
    redirect_uri: field(form, "redirect_uri"),
    response_type: field(form, "response_type"),
    code_challenge: field(form, "code_challenge"),
    code_challenge_method: field(form, "code_challenge_method"),
    state: field(form, "state"),
    resource: field(form, "resource"),
  };
  const outcome = await checkAuthorization(query);
  if (outcome.kind === "invalid") return refuse(400, outcome.description);
  if (outcome.kind === "redirect") return handBack(outcome.url);

  const url =
    field(form, "decision") === "allow"
      ? await approve(user.id, outcome.request)
      : deny(outcome.request);
  return handBack(url);
}
