/**
 * Outbound email, with no dependency added.
 *
 * Delivery is a driver, not a feature: the security-critical parts (single-use
 * hashed tokens, expiry, no account enumeration) do not care how the message
 * travels. The default transport prints the link to the server log, which is
 * exactly what you want in development and honest about what it is in
 * production -- nothing silently disappears.
 */
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

/** One fetch call, no SDK. Set RESEND_API_KEY and MAIL_FROM to enable. */
function resendTransport(apiKey: string, from: string): Transport {
  return {
    name: "resend",
    async send(mail) {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: [mail.to],
          subject: mail.subject,
          text: mail.text,
        }),
      });
      if (!res.ok) {
        throw new Error(`resend rejected the message: ${res.status} ${await res.text()}`);
      }
    },
  };
}

export function transport(): Transport {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM;
  return key && from ? resendTransport(key, from) : consoleTransport;
}

/**
 * Never let a delivery failure change what the caller reports. Password reset
 * must answer identically whether or not the address exists, and that promise
 * breaks the moment an SMTP error leaks into the response.
 */
export async function send(mail: Mail): Promise<void> {
  try {
    await transport().send(mail);
  } catch (e) {
    console.error("[todox] mail delivery failed:", (e as Error).message);
  }
}

export function baseUrl() {
  return process.env.TODOX_PUBLIC_URL ?? "http://localhost:3000";
}
