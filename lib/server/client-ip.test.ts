import { afterEach, describe, expect, it } from "vitest";

import { clientIp } from "./client-ip";

/**
 * The property under test is not "which entry is picked" but "can the caller
 * pick it". Every case below is written from the attacker's side: the client
 * sends an `x-forwarded-for` of its own, the proxies append to it, and the
 * question is whether anything the client wrote can come back out.
 */
const CLIENT = "203.0.113.7";
const FORGED = "1.2.3.4";
const PROXY = "10.0.0.2";
const CDN_EDGE = "172.16.0.9";

function headers(values: Record<string, string>): Headers {
  return new Headers(values);
}

afterEach(() => {
  delete process.env.TRUSTED_PROXY_HOPS;
});

describe("behind one proxy (the default)", () => {
  it("reads the address the proxy appended, not the one the client sent", () => {
    // What the proxy actually forwards when a client sends a header of its own.
    expect(clientIp(headers({ "x-forwarded-for": `${FORGED}, ${CLIENT}` }))).toBe(CLIENT);
  });

  it("ignores a whole forged chain", () => {
    const forged = "9.9.9.9, 8.8.8.8, 7.7.7.7";
    expect(clientIp(headers({ "x-forwarded-for": `${forged}, ${CLIENT}` }))).toBe(CLIENT);
  });

  it("reads a single entry as the client", () => {
    expect(clientIp(headers({ "x-forwarded-for": CLIENT }))).toBe(CLIENT);
  });

  it("tolerates the spacing proxies actually emit", () => {
    expect(clientIp(headers({ "x-forwarded-for": `${FORGED} ,  ${CLIENT} ` }))).toBe(CLIENT);
  });
});

describe("behind a CDN as well", () => {
  it("steps back over both hops to reach the client", () => {
    process.env.TRUSTED_PROXY_HOPS = "2";
    // The CDN appends the client; the proxy then appends the CDN.
    const chain = `${FORGED}, ${CLIENT}, ${CDN_EDGE}`;
    expect(clientIp(headers({ "x-forwarded-for": chain }))).toBe(CLIENT);
  });

  it("reads the client when the client sent no header of its own", () => {
    process.env.TRUSTED_PROXY_HOPS = "2";
    // Two hops, two entries: the CDN appended the client and the proxy
    // appended the CDN, so position 0 here is the client rather than
    // anything the client wrote.
    expect(clientIp(headers({ "x-forwarded-for": `${CLIENT}, ${CDN_EDGE}` }))).toBe(CLIENT);
  });

  it("does not move however much the client prepends", () => {
    process.env.TRUSTED_PROXY_HOPS = "2";
    const answers = ["", `${FORGED}, `, `${FORGED}, ${FORGED}, `].map((forged) =>
      clientIp(headers({ "x-forwarded-for": `${forged}${CLIENT}, ${CDN_EDGE}` })),
    );
    expect(answers).toEqual([CLIENT, CLIENT, CLIENT]);
  });
});

describe("a hop count that does not match the deployment", () => {
  it("answers unknown rather than reaching into what the client wrote", () => {
    // Configured for two proxies, one entry arrived. That entry may be an
    // honest proxy or an invented header, and nothing here can tell them
    // apart -- so it is not used either way.
    process.env.TRUSTED_PROXY_HOPS = "2";
    expect(clientIp(headers({ "x-forwarded-for": FORGED }))).toBe("unknown");
  });

  it("counting too low is coarse, never spoofable", () => {
    // One hop configured, two real ones: the answer is the CDN's own address.
    // Everybody behind that edge shares a bucket, which is the safe direction
    // to be wrong in.
    const chain = `${FORGED}, ${CLIENT}, ${CDN_EDGE}`;
    expect(clientIp(headers({ "x-forwarded-for": chain }))).toBe(CDN_EDGE);
  });
});

describe("with nothing in front of the process", () => {
  it("reads no forwarding header at all", () => {
    // Exposed directly, every one of these arrived from the caller. The
    // default of 1 would trust a hop that is not there.
    process.env.TRUSTED_PROXY_HOPS = "0";
    expect(clientIp(headers({ "x-forwarded-for": `${FORGED}, ${CLIENT}` }))).toBe("unknown");
    expect(clientIp(headers({ "x-real-ip": FORGED }))).toBe("unknown");
  });
});

describe("a hop count that cannot be believed", () => {
  for (const value of ["-1", "abc", "", "1.5", " "]) {
    it(`"${value}" falls back to the default rather than widening trust`, () => {
      process.env.TRUSTED_PROXY_HOPS = value;
      expect(clientIp(headers({ "x-forwarded-for": `${FORGED}, ${CLIENT}` }))).toBe(CLIENT);
    });
  }
});

describe("with no forwarding header", () => {
  it("falls back to x-real-ip", () => {
    expect(clientIp(headers({ "x-real-ip": PROXY }))).toBe(PROXY);
  });

  it("answers unknown when there is nothing to read", () => {
    expect(clientIp(headers({}))).toBe("unknown");
  });

  it("treats an empty header as absent", () => {
    expect(clientIp(headers({ "x-forwarded-for": " , ,, " }))).toBe("unknown");
  });
});
