import type { T } from "@/lib/i18n";
import * as oauthAccounts from "@/lib/repositories/oauth-accounts";
import * as users from "@/lib/repositories/users";
import { enabledProviders } from "@/lib/services/oauth-providers";

import { authMessages, isAuthCode } from "../auth-messages";
import { unlinkProviderAction } from "../auth-actions";
import { SubmitButton } from "../features/submit";
import { ConnectProvider } from "./connect-provider";

const PROVIDER_NAME: Record<oauthAccounts.OAuthProvider, string> = {
  google: "Google",
  github: "GitHub",
};

/**
 * The account's Google and GitHub sign-ins: each one either connected, with a
 * way to disconnect it, or a link to connect it. A provider this server has
 * no keys for is listed only if an identity from it is already linked, so it
 * can still be removed.
 */
export async function Connections({
  userId,
  errorCode,
  t,
}: {
  userId: number;
  errorCode: string;
  t: T;
}) {
  const [linked, user] = await Promise.all([oauthAccounts.listForUser(userId), users.byId(userId)]);
  const hasPassword = Boolean(user?.password_hash);
  const messages = authMessages(t);
  const enabled = enabledProviders();
  const shown = oauthAccounts.OAUTH_PROVIDERS.filter(
    (provider) => enabled.includes(provider) || linked.some((row) => row.provider === provider),
  );
  return (
    <div className="flex max-w-xl flex-col gap-4">
      <p className="text-small text-muted">{t("connectionsIntro")}</p>
      {isAuthCode(errorCode) && (
        <p role="alert" className="text-small text-[var(--k-dead_end)]">
          {authMessages(t)[errorCode]}
        </p>
      )}
      {shown.length === 0 ? (
        <p className="text-small text-muted">{t("connectionsNone")}</p>
      ) : (
        <ul className="flex flex-col">
          {shown.map((provider) => {
            const row = linked.find((account) => account.provider === provider);
            return (
              <li key={provider} className="settings-row">
                <span className="flex min-w-[10rem] flex-1 flex-col gap-0.5">
                  <span className="text-[15px]">{PROVIDER_NAME[provider]}</span>
                  {row && (
                    <span className="text-meta break-all text-faint">
                      {row.email
                        ? t("connectionsConnected", { email: row.email })
                        : t("connectionsConnectedNoEmail")}
                    </span>
                  )}
                </span>
                {row ? (
                  <form action={unlinkProviderAction}>
                    <input type="hidden" name="provider" value={provider} />
                    <SubmitButton className="btn btn-quiet" pendingLabel={t("working")}>
                      {t("connectionsDisconnect")}
                      <span className="sr-only"> — {PROVIDER_NAME[provider]}</span>
                    </SubmitButton>
                  </form>
                ) : (
                  <ConnectProvider
                    provider={provider}
                    providerName={PROVIDER_NAME[provider]}
                    hasPassword={hasPassword}
                    labels={{
                      connect: t("connectionsConnect"),
                      password: t("connectionsPasswordLabel", { provider: PROVIDER_NAME[provider] }),
                      continueTo: t("connectionsContinue", { provider: PROVIDER_NAME[provider] }),
                      working: t("working"),
                    }}
                    messages={messages}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
