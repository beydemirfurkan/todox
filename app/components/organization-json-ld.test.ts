import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import sitemap from "../sitemap";

/**
 * The set of pages carrying JSON-LD has to be the set of pages a crawler is
 * allowed to index, and nothing keeps those two together except this.
 *
 * The previous arrangement kept the schema in the root layout and suppressed it
 * on a hand-maintained list of noindex prefixes. That list drifted the moment
 * the header it read stopped existing, and nothing noticed for as long as the
 * component kept rendering — which it does either way, since the failure is
 * invisible in the page a person looks at.
 *
 * So the assertion is structural rather than behavioural: the routes in
 * `app/sitemap.ts` are the routes whose `page.tsx` imports the component, in
 * both directions. Adding a public page and forgetting the schema fails here,
 * and so does adding the schema to a page that is disallowed in `robots.ts`.
 */
const APP = join(import.meta.dirname, "..");
const COMPONENT = "organization-json-ld";

/** Every `page.tsx` under `app/`, as a route path. */
function pageFiles(): Map<string, string> {
  const files = new Map<string, string>();
  const walk = (dir: string, route: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        // Route groups and private folders do not add a segment.
        const segment = entry.name.startsWith("(") || entry.name.startsWith("_")
          ? route
          : `${route}/${entry.name}`;
        walk(full, segment);
      } else if (entry.name === "page.tsx") {
        files.set(route === "" ? "/" : route, readFileSync(full, "utf8"));
      }
    }
  };
  walk(APP, "");
  return files;
}

const pages = pageFiles();

/** The sitemap's URLs, reduced to paths. */
function sitemapPaths(): string[] {
  return sitemap().map((entry) => new URL(entry.url).pathname.replace(/(.)\/$/, "$1"));
}

describe("the pages that carry JSON-LD", () => {
  it("finds the page files at all", () => {
    // Guards the walker itself: an assertion over an empty set passes for the
    // wrong reason, and this whole file is an assertion over a set.
    expect(pages.size).toBeGreaterThan(5);
    expect([...pages.keys()]).toContain("/");
  });

  it("is exactly the set of routes in the sitemap", () => {
    const emitting = [...pages]
      .filter(([, source]) => source.includes(COMPONENT))
      .map(([route]) => route)
      .sort();

    expect(emitting).toEqual(sitemapPaths().sort());
  });

  it("is not emitted from the root layout, where it cannot know the route", () => {
    const layout = readFileSync(join(APP, "layout.tsx"), "utf8");
    expect(layout).not.toContain(COMPONENT);
  });

  it("cannot ask where it is", () => {
    // The whole bug was a component inferring the route and getting it wrong
    // in silence. Without access to the request there is nothing to infer:
    // the page that renders it is the page that decided it should.
    const source = readFileSync(join(APP, "components", `${COMPONENT}.tsx`), "utf8");
    expect(source).not.toContain("next/headers");
  });
});
