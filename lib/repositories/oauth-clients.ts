import { one, run } from "../db/client";

export const CLIENT_KINDS = ["cimd", "dcr", "first_party"] as const;
export type ClientKind = (typeof CLIENT_KINDS)[number];

/** A client as the rest of the code sees it: the JSON column already parsed. */
export interface OAuthClient {
  client_id: string;
  kind: ClientKind;
  client_name: string;
  redirect_uris: string[];
  created_at: string;
  fetched_at: string | null;
}

interface ClientRow extends Omit<OAuthClient, "redirect_uris"> {
  redirect_uris: string;
}

function parseRow(row: ClientRow): OAuthClient {
  const parsed: unknown = JSON.parse(row.redirect_uris);
  const uris = Array.isArray(parsed) ? parsed.filter((u): u is string => typeof u === "string") : [];
  return { ...row, redirect_uris: uris };
}

export async function find(clientId: string): Promise<OAuthClient | undefined> {
  const row = await one<ClientRow>("SELECT * FROM oauth_clients WHERE client_id = ?", [clientId]);
  return row ? parseRow(row) : undefined;
}

/**
 * Insert, or refresh what a metadata document now says. A registered (DCR)
 * client never collides here: its id is minted by us and is random.
 */
export const upsert = (client: OAuthClient): Promise<number> =>
  run(
    `INSERT INTO oauth_clients (client_id, kind, client_name, redirect_uris, created_at, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (client_id) DO UPDATE
       SET client_name = EXCLUDED.client_name,
           redirect_uris = EXCLUDED.redirect_uris,
           fetched_at = EXCLUDED.fetched_at`,
    [
      client.client_id,
      client.kind,
      client.client_name,
      JSON.stringify(client.redirect_uris),
      client.created_at,
      client.fetched_at,
    ],
  );
