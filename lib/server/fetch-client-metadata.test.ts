import { describe, expect, it } from "vitest";

import { fetchClientMetadata, isPublicAddress } from "./fetch-client-metadata";

describe("isPublicAddress", () => {
  it("lets the public internet through", () => {
    for (const ip of ["1.1.1.1", "160.79.104.10", "2606:4700::1111"]) expect(isPublicAddress(ip), ip).toBe(true);
  });

  it("keeps private, loopback, link-local and metadata addresses out", () => {
    for (const ip of [
      "127.0.0.1",
      "10.0.0.5",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "224.0.0.1",
      "::1",
      "::",
      "fd00::1",
      "fe80::1",
      "::ffff:127.0.0.1",
      "64:ff9b::a00:1",
      "not-an-ip",
    ])
      expect(isPublicAddress(ip), ip).toBe(false);
  });
});

describe("fetchClientMetadata", () => {
  it("never fetches over plain http or from a private address", async () => {
    expect(await fetchClientMetadata("http://example.com/meta")).toBeNull();
    expect(await fetchClientMetadata("https://127.0.0.1/meta")).toBeNull();
    expect(await fetchClientMetadata("https://[::1]/meta")).toBeNull();
  });
});
