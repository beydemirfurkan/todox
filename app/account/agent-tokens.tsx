import { ago, type T } from "@/lib/i18n";
import type { ApiToken } from "@/lib/types";
import { revokeTokenAction } from "../auth-actions";
import { Chip } from "../components";
import { SubmitButton } from "../features/submit";

/**
 * The `npx` line for the CLI login, from the release tarball the README
 * already points at: there is no npm package and there will not be one.
 */
export const LOGIN_COMMAND =
  "npx https://github.com/beydemirfurkan/todox/releases/latest/download/todox-mcp.tgz login";

/** A row is a grant when an authorised client holds it; everything else is a person's token. */
export const isGrant = (token: ApiToken): boolean => token.family_id !== null;

/**
 * One table for both kinds, because a person reading it wants the same three
 * things either way: what it is, whether it is being used, and how to end it.
 * Only the word on the button differs -- "disconnect" for an agent that asked,
 * "revoke" for a token somebody made.
 */
export function TokenTable({
  rows,
  actionLabel,
  t,
}: {
  rows: ApiToken[];
  actionLabel: string;
  t: T;
}): React.JSX.Element {
  return (
    <div className="account-token-table-wrap">
      <table className="account-token-table">
        <thead>
          <tr>
            <th scope="col">{t("tokenColumnName")}</th>
            <th scope="col">{t("tokenColumnActivity")}</th>
            <th scope="col">{t("tokenColumnCreated")}</th>
            <th scope="col" className="text-right">
              {t("tokenColumnActions")}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((tok) => (
            <tr key={tok.id}>
              <th scope="row" className="display font-bold">
                {tok.name}
              </th>
              <td>
                <Chip color={tok.last_used_at ? "var(--ok)" : undefined}>
                  {tok.last_used_at ? `${t("lastUsed")} ${ago(tok.last_used_at, t)}` : t("neverUsed")}
                </Chip>
              </td>
              <td className="mono text-meta text-faint">{ago(tok.created_at, t)}</td>
              <td className="text-right">
                <form action={revokeTokenAction}>
                  <input type="hidden" name="token_id" value={tok.id} />
                  <SubmitButton className="link-more !text-[12px]" pendingLabel={t("working")}>
                    {actionLabel}
                    <span className="sr-only"> — {tok.name}</span>
                  </SubmitButton>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
