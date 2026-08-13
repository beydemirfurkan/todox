/**
 * Outbound email.
 *
 * Delivery is a driver, not a feature: the security-critical parts (single-use
 * hashed tokens, expiry, no account enumeration) do not care how the message
 * travels. With no SMTP configured the console transport prints the body to
 * the server log, which is fine for development but unsafe in production --
 * the bodies carry reset and verification tokens. The build refuses to wire
 * the console transport when NODE_ENV is "production": better a loud failure
 * than a permanent token leak into log aggregation.
 */
import nodemailer from "nodemailer";

export type Mail = { to: string; subject: string; text: string };

export type Transport = {
  name: string;
  send(mail: Mail): Promise<void>;
};

const consoleTransport: Transport = {
  name: "console",
  async send(mail) {
    console.log(
      [
        "",
        "─── todox mail (console transport) ─────────────────────────",
        `to:      ${mail.to}`,
        `subject: ${mail.subject}`,
        "",
        mail.text,
        "────────────────────────────────────────────────────────────",
        "",
      ].join("\n"),
    );
  },
};

function smtpTransport(opts: {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
}): Transport {
  // Left to inference: annotating it as `Transporter` picks the generic
  // overload, which does not accept SMTP options.
  const client = nodemailer.createTransport({
    host: opts.host,
    port: opts.port,
    // 465 is TLS from the first byte; 587 opens in the clear and upgrades.
    secure: opts.port === 465,
    // Without this, STARTTLS is merely attempted: a server that does not
    // advertise it gets the password in plain text. Fail the connection
    // instead.
    requireTLS: opts.port !== 465,
    auth: { user: opts.user, pass: opts.pass },
    // Nodemailer waits two minutes by default. `send` is awaited inside
    // registration, so that is two minutes of somebody staring at a form.
    connectionTimeout: 7_000,
    greetingTimeout: 7_000,
    socketTimeout: 15_000,
    // No `pool`, and that is deliberate: a pooled connection outlives the
    // request but not the instance. The platform freezes us between
    // invocations, the socket dies unseen, and the next send fails on a
    // connection that looked open. One transporter, a fresh connection.
  });

  return {
    name: "smtp",
    async send(mail) {
      await client.sendMail({
        from: opts.from,
        to: mail.to,
        subject: mail.subject,
        text: mail.text,
      });
    },
  };
}

/**
 * The mail-was-never-sent stub for production when SMTP is missing. Throws
 * rather than returning silently so callers above know the token they thought
 * they were emailing never left the building.
 */
function refusingTransport(): Transport {
  return {
    name: "refusing",
    async send(mail) {
      throw new Error(
        `[todox] refusing to send mail to ${maskEmail(mail.to)}: SMTP is not ` +
          `configured. Set SMTP_HOST, SMTP_USER, SMTP_PASS and MAIL_FROM.`,
      );
    },
  };
}

/** Enough of the address to recognise, not enough to make the logs a mailing list. */
function maskEmail(address: string) {
  const [user, domain] = address.split("@");
  if (!domain) return "***";
  return `${user.slice(0, 1)}***@${domain}`;
}

let cached: Transport | null = null;
let warned = false;

function build(): Transport {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.MAIL_FROM;

  // An unreadable port falls back rather than disabling mail: silently posting
  // password resets to the log because of a typo in a number is a far worse
  // outcome than using the default one.
  const configured = Number(process.env.SMTP_PORT ?? 587);
  const port = Number.isFinite(configured) && configured > 0 ? configured : 587;
  if (port !== configured && process.env.SMTP_PORT !== undefined) {
    console.warn(`[todox] SMTP_PORT is not a number; using ${port}.`);
  }

  // All four or none. A half-configured transport is worse than an unconfigured
  // one, because it looks like mail should be going out.
  if (host && user && pass && from) {
    return smtpTransport({ host, port, user, pass, from });
  }

  // In production a misconfigured transport must not become a "log the reset
  // link for whoever reads the platform logs" backstop. Reset, verification and
  // invitation bodies carry tokens that grant full account access; letting
  // them reach the logs, with a warning the deployer reads once and forgets,
  // was a live leak. Fail loud, set the cookie, fall back to nothing.
  if (process.env.NODE_ENV === "production") {
    if (!warned) {
      warned = true;
      console.error(
        "[todox] SMTP is not configured in production; refusing to send mail. " +
          "Set SMTP_HOST, SMTP_USER, SMTP_PASS and MAIL_FROM. Until then, token-" +
          "bearing flows (reset, verify, invite) return without dispatching.",
      );
    }
    return refusingTransport();
  }

  // Local and test: the console transport exists so a developer running the
  // app can copy a reset link straight out of their terminal.
  if (!warned) {
    warned = true;
    console.warn("[todox] SMTP not configured; using console transport.");
  }
  return consoleTransport;
}

/** Built once: nodemailer's transporter is a connection factory, not a message. */
export function transport(): Transport {
  return (cached ??= build());
}

/**
 * Never let a delivery failure change what the caller reports. Password reset
 * must answer identically whether or not the address exists, and that promise
 * breaks the moment an SMTP error leaks into the response.
 *
 * The refusing transport (production + SMTP missing) is the one exception:
 * letting that throw swallow itself would mean the caller believes the token
 * has been emailed when in fact it never left the process. The bug is loud and
 * the caller notices.
 *
 * The log line carries enough to find the message and not enough to turn the
 * logs into a list of everyone's address.
 */
export async function send(mail: Mail): Promise<void> {
  const t = transport();
  try {
    await t.send(mail);
  } catch (e) {
    if (t.name === "refusing") throw e;
    console.error(
      `[todox] mail delivery failed (transport=${t.name}, to=${maskEmail(mail.to)}, ` +
        `subject=${JSON.stringify(mail.subject)}): ${(e as Error).message}`,
    );
  }
}
