import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { publicUrl } from "@/lib/public-url";
import { clientIp } from "@/lib/server/client-ip";
import { beginOAuth } from "@/lib/oauth-begin";
import { isProvider, safeNext } from "@/lib/services/oauth-flow";
import * as limit from "@/lib/services/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Off to Google or GitHub to sign in. A plain GET a link can point at, because
 * the buttons are links: the CSP allows forms to post only to this origin, and
 * the provider is not this origin. Linking a new identity to an account that
 * is already signed in does not start here: it needs the password first, so it
 * starts from `startProviderLinkAction`.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
): Promise<Response> {
  const { provider } = await params;
  const back = (code: string) => NextResponse.redirect(`${publicUrl()}/login?error=${code}`);
  if (!isProvider(provider)) return back("oauthFailed");

  const gate = await limit.consume("oauthPerIp", clientIp(await headers()));
  if (!gate.allowed) return back("tooManyAttempts");

  const next = safeNext(new URL(request.url).searchParams.get("next"));
  const target = await beginOAuth({ provider, next });
  if (!target) return back("oauthFailed");
  return NextResponse.redirect(target);
}
