import type { Metadata, Viewport } from "next";
import { DM_Mono, Geist } from "next/font/google";
import Link from "next/link";
import { Suspense } from "react";
import "./globals.css";
import type { T } from "@/lib/i18n";
import { getLang, getT } from "@/lib/lang";
import { currentUser } from "@/lib/session";
import { publicUrl } from "@/lib/public-url";
import { LogoMark } from "./components";
import { LangSwitcher } from "./features/lang-switcher";
import { Notifications } from "./features/notifications";
import { SearchBox } from "./features/search-box";
import { TzProbe } from "./features/tz-probe";
import { UserMenu } from "./features/user-menu";
import { defaultOpenGraphImage } from "./metadata-shared";

const geist = Geist({ variable: "--font-geist", subsets: ["latin", "latin-ext"] });
const dmMono = DM_Mono({
  variable: "--font-dm-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

/**
 * The cookie controls the language the page renders in, so the metadata has to
 * follow it. `getLang()` is async and reads the cookie through `next/headers`,
 * so this must be `generateMetadata` rather than a static `metadata` object.
 *
 * The base URL is whatever the deployment reports, not the audit's preferred
 * host, so a future move to another domain only needs `TODOX_PUBLIC_URL`.
 */
export async function generateMetadata(): Promise<Metadata> {
  const lang = await getLang();
  const { t } = await getT();
  const base = publicUrl();
  return {
    metadataBase: new URL(base),
    title: {
      default: t("metaTitleHome"),
      template: `%s — ${t("siteName")}`,
    },
    description: t("metaDescription"),
    // No `languages` map. It used to list `en`, `tr` and `x-default` all
    // pointing at `/`, which is not an alternate — it is the same URL claimed
    // three times, and `hreflang` exists to say "the same page, at a different
    // address". This site serves both languages from one address and picks by
    // cookie then `Accept-Language`, so there is no second address to name.
    // Saying nothing is accurate; the old block was a claim that could not be
    // acted on.
    alternates: { canonical: "/" },
    openGraph: {
      siteName: t("siteName"),
      locale: lang === "tr" ? "tr_TR" : "en_US",
      type: "website",
      url: base,
      // Per-page metadata should use `pageOpenGraph(path)` from
      // `metadata-shared.ts` so the card survives the shallow merge.
      images: [defaultOpenGraphImage],
    },
    twitter: {
      card: "summary_large_image",
    },
  };
}

/** One theme: the browser chrome and form controls match the dark page. */
export const viewport: Viewport = {
  themeColor: "#09090b",
  colorScheme: "dark",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const { lang, t } = await getT();
  const user = await currentUser();

  return (
    <html
      lang={lang}
      className={`${geist.variable} ${dmMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <TzProbe />

        <a href="#main" className="skip-link display">
          {t("skipToContent")}
        </a>

        <header className="relative z-20 mx-auto flex w-full page-column flex-wrap items-center gap-x-3 gap-y-2 px-5 pt-4 pb-2 sm:pt-6 sm:pb-3">
          {/* "/" for everyone now: signed out it is the page that explains what
              this is, which used to be nowhere. */}
          <Link href="/" className="brand flex items-center gap-2.5">
            <LogoMark size={28} />
            <span className="display text-[22px] leading-none">
              todox
            </span>
          </Link>
          <span className="mono mt-1 hidden border-l border-line pl-3 text-meta text-faint sm:block">
            {t("tagline")}
          </span>

          {user ? (
            <>
              {/* The tools take the second row on a phone. A 320px screen fits
                  the wordmark and one control, so all four beside it is what
                  used to drag the page sideways; sign-out and the report link
                  moved into the user menu rather than being wrapped onto a
                  third row. On larger screens this group pushes itself and the
                  profile menu right, while the profile remains the last item. */}
              <div className="order-2 flex w-full items-center gap-2 sm:order-none sm:ml-auto sm:w-auto">
                {/* `min-w` and not just `flex-1`: a basis of zero let the box
                    squeeze to 22px rather than push anything onto a new line.
                    The fixed width, and the widening on focus that used to
                    shove the row off-screen, wait until there is room. */}
                <div className="min-w-[6.5rem] flex-1 transition-[width] duration-200 sm:w-[210px] sm:flex-none sm:focus-within:w-[280px]">
                  <Suspense>
                    <SearchBox
                      placeholder={t("searchPlaceholder")}
                      label={t("searchLabel")}
                      clearLabel={t("searchClear")}
                    />
                  </Suspense>
                </div>
                <LangSwitcher lang={lang} t={t} />
                {/* Its own boundary: the feed can only be fetched once the
                    session is known, so awaiting it here would put a second
                    sequential query in front of every page. */}
                <Suspense>
                  <Notifications userId={user.id} />
                </Suspense>
              </div>

              <UserMenu
                user={user}
                labels={{
                  navAccount: t("navAccount"),
                  navReport: t("navReport"),
                  navBrain: t("navBrain"),
                  signOut: t("signOut"),
                  working: t("working"),
                }}
                className="ml-auto shrink-0 sm:ml-0"
              />
            </>
          ) : (
            <div className="ml-auto flex items-center gap-2">
              <LangSwitcher lang={lang} t={t} />
              <Link href="/login" className="pill">
                {t("signIn")}
              </Link>
            </div>
          )}
        </header>

        <main
          id="main"
          className="relative z-10 mx-auto w-full page-column flex-1 px-5 pt-2 pb-16"
        >
          {children}
        </main>

        <SiteFooter t={t} />
      </body>
    </html>
  );
}

const REPO = "https://github.com/beydemirfurkan/todox";

/** The graphite band every page ends on: the name and what it does, then
 *  the links in three short columns. */
function SiteFooter({ t }: { t: T }) {
  const columns: { title: string; links: { href: string; label: string; external?: boolean }[] }[] = [
    {
      title: t("footerColProduct"),
      links: [
        { href: "/about", label: t("footerAbout") },
        { href: "/blog", label: t("footerBlog") },
      ],
    },
    {
      title: t("footerColOpen"),
      links: [
        { href: REPO, label: t("footerSource"), external: true },
        { href: `${REPO}/blob/main/docs/mcp.md`, label: t("footerMcpGuide"), external: true },
      ],
    },
    {
      title: t("footerColHelp"),
      links: [
        { href: "/privacy", label: t("footerPrivacy") },
        { href: "/contact", label: t("footerContact") },
      ],
    },
  ];
  return (
    <footer className="site-band mt-20">
      <div className="mx-auto grid w-full page-column grid-cols-2 gap-10 px-5 pt-14 pb-14 md:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div className="col-span-2 flex flex-col gap-3 md:col-span-1">
          <span className="flex items-center gap-2.5">
            <LogoMark size={26} />
            <span className="display text-[22px] leading-none">todox</span>
          </span>
          <p className="mono text-meta text-[var(--band-muted)]">{t("tagline")}</p>
        </div>
        {columns.map((column) => (
          <nav key={column.title} aria-label={column.title} className="flex flex-col gap-3 text-[14px]">
            <h2 className="band-label text-meta font-medium">{column.title}</h2>
            {column.links.map((link) =>
              link.external ? (
                <a key={link.href} href={link.href} rel="noreferrer" className="band-link">
                  {link.label}
                </a>
              ) : (
                <Link key={link.href} href={link.href} className="band-link">
                  {link.label}
                </Link>
              ),
            )}
          </nav>
        ))}
      </div>
    </footer>
  );
}
