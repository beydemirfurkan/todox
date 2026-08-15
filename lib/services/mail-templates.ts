/**
 * Every message todox sends, in both languages, in one file.
 *
 * These used to be inline ternaries at the five call sites, which is why
 * CONTRIBUTING calls them "the one place strings are not in both dictionaries".
 * They still are not — a mail body is a paragraph with a link in it, not a UI
 * label, and `lib/i18n` is keyed for labels — but at least the Turkish and the
 * English now sit next to each other, where a mismatch is visible.
 *
 * Each template returns `text` as well as `html`. That is not politeness:
 * a message with no plain-text part scores worse with spam filters, and the
 * text is what a screen reader, a terminal client, or a notification preview
 * actually reads.
 */

const BRAND = {
  paper: "#191b22",
  ink: "#f1eee5",
  muted: "#a5a196",
  accent: "#ffd84d",
  onAccent: "#191b22",
  rule: "#2e313a",
} as const;

/**
 * Anything interpolated into HTML is escaped, without exception.
 *
 * Names, project names and email addresses are chosen by people, and two of
 * these messages are security notices. An unescaped display name is enough to
 * inject a second, convincing-looking link into a "your email was changed"
 * warning — the one message whose whole job is to be trusted by somebody who
 * may have just been compromised.
 */
const esc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

type Block =
  | { kind: "text"; body: string }
  | { kind: "button"; label: string; href: string }
  | { kind: "link"; href: string }
  | { kind: "note"; body: string };

/**
 * Tables and inline styles, which is not how anyone writes HTML any more and is
 * still how email works: Outlook renders through Word, and a stylesheet in the
 * head is stripped by several clients. Nothing loads from the network either —
 * a remote image is blocked by default and would only leak that the mail was
 * opened.
 */
function layout(title: string, blocks: Block[], footer: string) {
  const content = blocks
    .map((b) => {
      switch (b.kind) {
        case "text":
          return `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${BRAND.ink}">${b.body}</p>`;
        case "button":
          return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 16px"><tr><td style="border-radius:8px;background:${BRAND.accent}"><a href="${esc(b.href)}" style="display:inline-block;padding:12px 22px;font-size:15px;font-weight:700;color:${BRAND.onAccent};text-decoration:none;border-radius:8px">${b.label}</a></td></tr></table>`;
        // The same URL as plain text under the button. A button is a link a
        // client can mangle, block, or rewrite for tracking; this is the copy
        // somebody can still paste into a browser.
        case "link":
          return `<p style="margin:0 0 16px;font-size:13px;line-height:1.5;word-break:break-all"><a href="${esc(b.href)}" style="color:${BRAND.accent}">${esc(b.href)}</a></p>`;
        case "note":
          return `<p style="margin:0 0 16px;font-size:13.5px;line-height:1.6;color:${BRAND.muted}">${b.body}</p>`;
      }
    })
    .join("");

  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark"></head>
<body style="margin:0;padding:0;background:${BRAND.paper}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.paper};padding:32px 16px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:${BRAND.paper};border:1px solid ${BRAND.rule};border-radius:14px;padding:28px">
<tr><td>
<p style="margin:0 0 22px;font-size:19px;font-weight:700;letter-spacing:-0.01em;color:${BRAND.accent}">todox</p>
<h1 style="margin:0 0 18px;font-size:21px;line-height:1.3;font-weight:700;color:${BRAND.ink}">${title}</h1>
${content}
<hr style="border:0;border-top:1px solid ${BRAND.rule};margin:22px 0 14px">
<p style="margin:0;font-size:12.5px;line-height:1.5;color:${BRAND.muted}">${footer}</p>
</td></tr></table>
</td></tr></table>
</body></html>`;
}

export type Lang = "tr" | "en";
export type Template = { subject: string; text: string; html: string };

const FOOTER: Record<Lang, string> = {
  tr: "todox — geliştiriciler ve ajanları için çalışma belleği. Bu e-postayı beklemiyorsan görmezden gelebilirsin.",
  en: "todox — working memory for developers and their agents. If you were not expecting this, you can ignore it.",
};

export function passwordReset(input: {
  name: string;
  link: string;
  minutes: number;
  lang: Lang;
}): Template {
  const { name, link, minutes, lang } = input;
  if (lang === "tr") {
    return {
      subject: "todox şifre sıfırlama",
      text: [
        `Merhaba ${name},`,
        "",
        "Şifreni sıfırlamak için bu bağlantıyı aç:",
        link,
        "",
        `Bağlantı ${minutes} dakika geçerli ve yalnızca bir kez kullanılabilir.`,
        "Bu isteği sen yapmadıysan hiçbir şey yapmana gerek yok.",
      ].join("\n"),
      html: layout(
        "Şifreni sıfırla",
        [
          { kind: "text", body: `Merhaba ${esc(name)},` },
          { kind: "text", body: "Yeni bir şifre belirlemek için:" },
          { kind: "button", label: "Şifremi sıfırla", href: link },
          { kind: "link", href: link },
          {
            kind: "note",
            body: `Bağlantı ${minutes} dakika geçerli ve yalnızca bir kez kullanılabilir. Bu isteği sen yapmadıysan hiçbir şey yapmana gerek yok.`,
          },
        ],
        FOOTER.tr,
      ),
    };
  }
  return {
    subject: "Reset your todox password",
    text: [
      `Hi ${name},`,
      "",
      "Open this link to set a new password:",
      link,
      "",
      `It is valid for ${minutes} minutes and works once.`,
      "If you did not ask for this, you can ignore it.",
    ].join("\n"),
    html: layout(
      "Reset your password",
      [
        { kind: "text", body: `Hi ${esc(name)},` },
        { kind: "text", body: "Set a new password here:" },
        { kind: "button", label: "Reset password", href: link },
        { kind: "link", href: link },
        {
          kind: "note",
          body: `It is valid for ${minutes} minutes and works once. If you did not ask for this, you can ignore it.`,
        },
      ],
      FOOTER.en,
    ),
  };
}

export function verifyEmail(input: {
  name: string;
  link: string;
  days: number;
  lang: Lang;
}): Template {
  const { name, link, days, lang } = input;
  if (lang === "tr") {
    return {
      subject: "todox e-posta doğrulama",
      text: [
        `Merhaba ${name},`,
        "",
        "E-posta adresini doğrulamak için:",
        link,
        "",
        `Bağlantı ${days} gün geçerli.`,
      ].join("\n"),
      html: layout(
        "E-posta adresini doğrula",
        [
          { kind: "text", body: `Merhaba ${esc(name)},` },
          { kind: "text", body: "Adresin sana ait olduğunu doğrulamak için:" },
          { kind: "button", label: "Adresimi doğrula", href: link },
          { kind: "link", href: link },
          { kind: "note", body: `Bağlantı ${days} gün geçerli.` },
        ],
        FOOTER.tr,
      ),
    };
  }
  return {
    subject: "Confirm your todox email",
    text: [
      `Hi ${name},`,
      "",
      "Confirm your email address:",
      link,
      "",
      `The link is valid for ${days} days.`,
    ].join("\n"),
    html: layout(
      "Confirm your email",
      [
        { kind: "text", body: `Hi ${esc(name)},` },
        { kind: "text", body: "Confirm this address belongs to you:" },
        { kind: "button", label: "Confirm email", href: link },
        { kind: "link", href: link },
        { kind: "note", body: `The link is valid for ${days} days.` },
      ],
      FOOTER.en,
    ),
  };
}

/**
 * The one message that goes to an address which may no longer be the account's.
 *
 * It is deliberately the plainest of the five: no button. Somebody reading this
 * has just been told their account changed hands, and the useful thing is the
 * fact and the address to check, not a call to action.
 */
export function emailChanged(input: {
  name: string;
  username: string;
  previousEmail: string;
  newEmail: string;
  forgotUrl: string;
  lang: Lang;
}): Template {
  const { name, username, previousEmail, newEmail, forgotUrl, lang } = input;
  if (lang === "tr") {
    return {
      subject: "todox e-posta adresin değişti",
      text: [
        `Merhaba ${name},`,
        "",
        `@${username} hesabının e-posta adresi ${previousEmail} yerine`,
        `${newEmail} olarak değiştirildi.`,
        "",
        "Bunu sen yaptıysan yapman gereken bir şey yok.",
        "Yapmadıysan hesabına başkası erişiyor demektir: hemen şifreni",
        `sıfırla (${forgotUrl}) ve ajan tokenlarını iptal et.`,
      ].join("\n"),
      html: layout(
        "Hesabının e-posta adresi değişti",
        [
          { kind: "text", body: `Merhaba ${esc(name)},` },
          {
            kind: "text",
            body: `<strong>@${esc(username)}</strong> hesabının e-posta adresi ${esc(previousEmail)} yerine <strong>${esc(newEmail)}</strong> olarak değiştirildi.`,
          },
          { kind: "text", body: "Bunu sen yaptıysan yapman gereken bir şey yok." },
          {
            kind: "note",
            body: `Yapmadıysan hesabına başkası erişiyor demektir: hemen <a href="${esc(forgotUrl)}" style="color:${BRAND.accent}">şifreni sıfırla</a> ve ajan tokenlarını iptal et.`,
          },
        ],
        FOOTER.tr,
      ),
    };
  }
  return {
    subject: "Your todox email was changed",
    text: [
      `Hi ${name},`,
      "",
      `The email address on @${username} was changed from ${previousEmail}`,
      `to ${newEmail}.`,
      "",
      "If that was you, there is nothing to do.",
      "If it was not, somebody else has access: reset your password now",
      `(${forgotUrl}) and revoke your agent tokens.`,
    ].join("\n"),
    html: layout(
      "Your account email was changed",
      [
        { kind: "text", body: `Hi ${esc(name)},` },
        {
          kind: "text",
          body: `The email address on <strong>@${esc(username)}</strong> was changed from ${esc(previousEmail)} to <strong>${esc(newEmail)}</strong>.`,
        },
        { kind: "text", body: "If that was you, there is nothing to do." },
        {
          kind: "note",
          body: `If it was not, somebody else has access: <a href="${esc(forgotUrl)}" style="color:${BRAND.accent}">reset your password</a> now and revoke your agent tokens.`,
        },
      ],
      FOOTER.en,
    ),
  };
}

export function projectInvitation(input: {
  projectName: string;
  link: string;
  days: number;
  lang: Lang;
}): Template {
  const { projectName, link, days, lang } = input;
  if (lang === "tr") {
    return {
      subject: `${projectName} projesine davet edildiniz`,
      text: `${projectName} projesinde birlikte çalışmak için davet edildiniz.\n\nDaveti görüntüleyin ve kabul edin:\n${link}\n\nBu bağlantı ${days} gün geçerlidir.`,
      html: layout(
        "Bir projeye davet edildin",
        [
          {
            kind: "text",
            body: `<strong>${esc(projectName)}</strong> projesinde birlikte çalışmak için davet edildin.`,
          },
          { kind: "button", label: "Daveti görüntüle", href: link },
          { kind: "link", href: link },
          { kind: "note", body: `Bu bağlantı ${days} gün geçerlidir.` },
        ],
        FOOTER.tr,
      ),
    };
  }
  return {
    subject: `You were invited to ${projectName}`,
    text: `You were invited to collaborate on ${projectName}.\n\nReview and accept the invitation:\n${link}\n\nThis link expires in ${days} days.`,
    html: layout(
      "You were invited to a project",
      [
        {
          kind: "text",
          body: `You were invited to collaborate on <strong>${esc(projectName)}</strong>.`,
        },
        { kind: "button", label: "Review the invitation", href: link },
        { kind: "link", href: link },
        { kind: "note", body: `This link expires in ${days} days.` },
      ],
      FOOTER.en,
    ),
  };
}

export function invitationAccepted(input: {
  who: string;
  projectName: string;
  url: string;
  lang: Lang;
}): Template {
  const { who, projectName, url, lang } = input;
  if (lang === "tr") {
    return {
      subject: `${projectName} davetin kabul edildi`,
      text: `${who} ${projectName} projesine katıldı.\n\nArtık görevleri ve kaydı birlikte görüyorsunuz:\n${url}`,
      html: layout(
        "Davetin kabul edildi",
        [
          {
            kind: "text",
            body: `<strong>${esc(who)}</strong>, <strong>${esc(projectName)}</strong> projesine katıldı.`,
          },
          { kind: "text", body: "Artık görevleri ve kaydı birlikte görüyorsunuz." },
          { kind: "button", label: "Projeyi aç", href: url },
        ],
        FOOTER.tr,
      ),
    };
  }
  return {
    subject: `Your invitation to ${projectName} was accepted`,
    text: `${who} joined ${projectName}.\n\nYou now share its tasks and its log:\n${url}`,
    html: layout(
      "Your invitation was accepted",
      [
        {
          kind: "text",
          body: `<strong>${esc(who)}</strong> joined <strong>${esc(projectName)}</strong>.`,
        },
        { kind: "text", body: "You now share its tasks and its log." },
        { kind: "button", label: "Open the project", href: url },
      ],
      FOOTER.en,
    ),
  };
}
