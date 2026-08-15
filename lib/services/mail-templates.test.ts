import { describe, expect, it } from "vitest";

import {
  emailChanged,
  invitationAccepted,
  passwordReset,
  projectInvitation,
  verifyEmail,
  type Lang,
  type Template,
} from "./mail-templates";

const LANGS: Lang[] = ["tr", "en"];

/** Every template, built with values a person could actually have chosen. */
const build = (lang: Lang, name: string): Record<string, Template> => ({
  passwordReset: passwordReset({
    name,
    link: "https://todox.dev/reset?token=abc",
    minutes: 30,
    lang,
  }),
  verifyEmail: verifyEmail({
    name,
    link: "https://todox.dev/verify?token=abc",
    days: 7,
    lang,
  }),
  emailChanged: emailChanged({
    name,
    username: name,
    previousEmail: "old@example.com",
    newEmail: "new@example.com",
    forgotUrl: "https://todox.dev/forgot",
    lang,
  }),
  projectInvitation: projectInvitation({
    projectName: name,
    link: "https://todox.dev/invite?token=abc",
    days: 14,
    lang,
  }),
  invitationAccepted: invitationAccepted({
    who: name,
    projectName: name,
    url: "https://todox.dev",
    lang,
  }),
});

describe("every template is complete in both languages", () => {
  for (const lang of LANGS) {
    for (const [which, t] of Object.entries(build(lang, "Ada"))) {
      it(`${which} (${lang}) has a subject, text and html`, () => {
        expect(t.subject.trim()).not.toBe("");
        expect(t.text.trim()).not.toBe("");
        expect(t.html).toContain("<!doctype html>");
        // The plain-text part is not optional: without it the message scores
        // worse with spam filters, and it is what a screen reader reads.
        expect(t.text).not.toContain("<");
      });
    }
  }

  it("says something different in each language", () => {
    const tr = build("tr", "Ada");
    const en = build("en", "Ada");
    for (const which of Object.keys(tr)) {
      expect(tr[which].subject).not.toBe(en[which].subject);
    }
  });
});

describe("the link survives into both parts", () => {
  const withLink = ["passwordReset", "verifyEmail", "projectInvitation"];

  for (const lang of LANGS) {
    for (const which of withLink) {
      it(`${which} (${lang}) carries the url in text and html`, () => {
        const t = build(lang, "Ada")[which];
        const link = t.text.match(/https:\/\/todox\.dev\/\S+/)?.[0];
        expect(link).toBeTruthy();
        expect(t.html).toContain(link!);
      });
    }
  }
});

/**
 * The half of this file that matters.
 *
 * Names, usernames and project names are chosen by people, and two of these
 * messages are security notices. An unescaped display name is enough to inject
 * a second, convincing link into the "your email was changed" warning — the one
 * message whose whole job is to be trusted by somebody who may have just lost
 * control of their account.
 */
describe("user-supplied text cannot become markup", () => {
  const EVIL = '<a href="https://phish.example">Reset here</a>';

  for (const lang of LANGS) {
    for (const [which, t] of Object.entries(build(lang, EVIL))) {
      it(`${which} (${lang}) escapes it`, () => {
        expect(t.html).not.toContain("<a href=\"https://phish.example\"");
        expect(t.html).toContain("&lt;a href=&quot;https://phish.example&quot;");
      });
    }
  }

  it("escapes the ampersand first, so escaping cannot be undone", () => {
    // &lt; must survive as &amp;lt; -- escaping < before & would produce &lt;
    // and a client would render a literal "<".
    const t = passwordReset({
      name: "&lt;script&gt;",
      link: "https://todox.dev/reset",
      minutes: 30,
      lang: "en",
    });
    expect(t.html).toContain("&amp;lt;script&amp;gt;");
  });

  /** The plain-text part is not markup, so it is left exactly as typed. */
  it("leaves the text part alone", () => {
    const t = passwordReset({
      name: EVIL,
      link: "https://todox.dev/reset",
      minutes: 30,
      lang: "en",
    });
    expect(t.text).toContain(EVIL);
  });
});

describe("the security notice", () => {
  it("offers no button, only the fact and where to act", () => {
    for (const lang of LANGS) {
      const t = build(lang, "Ada").emailChanged;
      // A call-to-action button is what a phishing copy of this mail would
      // have. This one states what happened and links only to /forgot.
      expect(t.html).not.toContain("border-radius:8px;background:#ffd84d");
      expect(t.html).toContain("https://todox.dev/forgot");
    }
  });

  it("names both addresses, so the reader can tell which is which", () => {
    const t = build("en", "Ada").emailChanged;
    expect(t.text).toContain("old@example.com");
    expect(t.text).toContain("new@example.com");
    expect(t.html).toContain("old@example.com");
    expect(t.html).toContain("new@example.com");
  });
});
