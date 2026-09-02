import { describe, expect, it } from "vitest";

import { isLocalDatabase } from "./local-only";

/**
 * The one decision standing between a test suite and somebody's real data.
 *
 * It has already been wrong once, in the only way that counts: the suites ran
 * against production and left accounts behind that were read as real signups
 * for three weeks. The parsing here is short enough to look obviously correct,
 * which is exactly why it is asserted -- a guard nobody tests is a guard that
 * quietly starts answering true.
 */

describe("what counts as local", () => {
  for (const url of [
    "postgresql://todox:todox@localhost:5432/todox",
    "postgres://todox:todox@127.0.0.1:5432/todox",
    "postgresql://todox:todox@0.0.0.0:5432/todox",
    "postgresql://todox:todox@[::1]:5432/todox",
    // The service name a container gets on a compose or Actions network. A
    // guard that fails CI is worse than no guard, so these are allowed on
    // purpose rather than discovered when the pipeline goes red.
    "postgresql://todox:todox@postgres:5432/todox",
    "postgresql://todox:todox@db:5432/todox",
  ])
    it(`allows ${url.replace(/\/\/[^@]*@/, "//")}`, () => {
      expect(isLocalDatabase(url)).toBe(true);
    });
});

describe("what does not", () => {
  for (const [label, url] of [
    ["a hostname", "postgresql://todox:pw@db.example.com:5432/todox"],
    ["a public address", "postgresql://todox:pw@31.97.125.110:5432/todox"],
    // The shape the incident actually had: a container name reached over a
    // tunnel. It is not in the allow-list, and that is the point.
    ["a container name", "postgresql://todox:pw@kap8uvh13gqw6ph4tpfs9zts:5432/todox"],
    ["a subdomain that merely starts with localhost", "postgresql://u:p@localhost.evil.com/db"],
  ] as const)
    it(`refuses ${label}`, () => {
      expect(isLocalDatabase(url)).toBe(false);
    });

  /**
   * "Cannot tell" has to mean "do not write". A unix socket path is a real and
   * reasonable way to reach a local database, and it is still refused here --
   * an override exists for that, and being wrong in this direction costs a
   * flag rather than somebody's rows.
   */
  it("refuses anything it cannot parse", () => {
    expect(isLocalDatabase(undefined)).toBe(false);
    expect(isLocalDatabase("")).toBe(false);
    expect(isLocalDatabase("not a url")).toBe(false);
    expect(isLocalDatabase("/var/run/postgresql")).toBe(false);
  });

  it("is not fooled by case", () => {
    expect(isLocalDatabase("postgresql://u:p@LOCALHOST:5432/todox")).toBe(true);
    expect(isLocalDatabase("postgresql://u:p@DB.EXAMPLE.COM:5432/todox")).toBe(false);
  });
});
