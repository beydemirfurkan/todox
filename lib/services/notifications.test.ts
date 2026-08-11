import { describe, expect, it } from "vitest";

import { NOTIFICATION_KINDS } from "../constants";
import { LANGS, translator } from "../i18n";
import type { NotificationView } from "../types";
import { notificationHref, notificationText } from "./notifications";

const row = (over: Partial<NotificationView> = {}): NotificationView => ({
  id: 1,
  user_id: 1,
  kind: "invite_accepted",
  project_id: 7,
  actor_id: 2,
  detail: null,
  created_at: "2026-01-01T00:00:00.000Z",
  read_at: null,
  project_name: "todox",
  project_slug: "todox",
  actor_name: "Mert",
  ...over,
});

describe("notificationText", () => {
  /**
   * The dictionaries are typed against each other, so a missing key cannot
   * compile. What that does not catch is this switch reaching for a key that
   * says nothing about the kind it was handed -- or a new kind added to the
   * union whose sentence nobody wrote. Walking the union is the only thing
   * that does.
   */
  it("says something in every language for every kind", () => {
    for (const lang of LANGS) {
      const t = translator(lang);
      for (const kind of NOTIFICATION_KINDS) {
        const text = notificationText(row({ kind }), t);
        expect(text.trim(), `${lang}/${kind}`).not.toBe("");
        // A placeholder left unsubstituted is the failure this catches.
        expect(text, `${lang}/${kind}`).not.toContain("{");
        expect(text, `${lang}/${kind}`).toContain("todox");
      }
    }
  });

  /** `actor_id` is ON DELETE SET NULL, so no name is a real state. */
  it("survives an actor who deleted their account", () => {
    const t = translator("tr");
    const text = notificationText(row({ actor_id: null, actor_name: null }), t);
    expect(text).not.toContain("null");
    expect(text).not.toContain("{");
    expect(text.trim()).not.toBe("");
  });

  it("survives a project that is gone", () => {
    const t = translator("en");
    const text = notificationText(row({ project_id: null, project_name: null }), t);
    expect(text).not.toContain("null");
    expect(text).not.toContain("{");
  });
});

describe("notificationHref", () => {
  it("sends an invitation to the list that can accept it", () => {
    expect(notificationHref(row({ kind: "invite_received" }))).toBe(
      "/account?tab=invites",
    );
  });

  it("uses the recipient's own slug for the project", () => {
    expect(notificationHref(row({ project_slug: "todox-2" }))).toBe("/p/todox-2");
  });

  /**
   * No slug means no access: a membership just removed, or an invitation not
   * yet accepted. A link to a 404 is worse than plain text.
   */
  it("refuses to link where the recipient cannot go", () => {
    expect(notificationHref(row({ kind: "member_removed", project_slug: null }))).toBe(
      null,
    );
  });
});
