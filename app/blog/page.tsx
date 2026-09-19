import type { Metadata } from "next";
import Link from "next/link";

import { OrganizationJsonLd } from "../components/organization-json-ld";
import { pageOpenGraph } from "../metadata-shared";

/**
 * The posts, newest first. One so far; the list exists so the URL a reader
 * lands on from a post has somewhere to go, and so the next post has a place
 * to be listed without a design decision.
 *
 * Not in the dictionaries, for the reason the post gives: these are dated
 * documents in one language, not UI.
 */
export const dynamic = "force-dynamic";

const POSTS = [
  {
    slug: "six-weeks-on-our-own-log",
    title: "Six weeks on our own log",
    date: "19 September 2026",
    lede:
      "We built a memory server for coding agents and pointed it at ourselves: what the agents wrote, what they never closed, and the feature we were proudest of that nobody called.",
  },
] as const;

export function generateMetadata(): Metadata {
  return {
    title: { absolute: "Blog — todox" },
    description: "What we measured while running todox on our own work, and what changed because of it.",
    alternates: { canonical: "/blog" },
    openGraph: pageOpenGraph("/blog"),
  };
}

export default function BlogIndex() {
  return (
    <section className="prose pop mx-auto">
      <OrganizationJsonLd />
      <h1 className="display text-[28px] leading-[1.1] font-bold sm:text-[36px]">Blog</h1>
      <p className="mt-2 text-[15.5px] text-muted">
        What we measured while running todox on our own work, and what changed because of it.
      </p>
      <ul className="mt-6 space-y-4">
        {POSTS.map((post) => (
          <li key={post.slug} className="sticker lift p-4">
            <p className="mono text-[12.5px] text-faint">{post.date}</p>
            <h2 className="display mt-1 text-[21px] leading-tight font-bold">
              <Link href={`/blog/${post.slug}`} className="link-more">
                {post.title}
              </Link>
            </h2>
            <p className="mt-1.5 text-[14.5px] leading-relaxed text-muted">{post.lede}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
