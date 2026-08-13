import type { Metadata } from "next";
import { DM_Mono, Instrument_Sans, Shantell_Sans } from "next/font/google";
import Link from "next/link";
import { Suspense } from "react";
import "./globals.css";
import { getLang, getT } from "@/lib/lang";
import { currentUser } from "@/lib/session";
import { publicUrl } from "@/lib/public-url";
import { Blob } from "./components";
import { OrganizationJsonLd } from "./components/organization-json-ld";
import { LangSwitcher } from "./features/lang-switcher";
import { Notifications } from "./features/notifications";
import { SearchBox } from "./features/search-box";
import { TzProbe } from "./features/tz-probe";
import { UserMenu } from "./features/user-menu";
import { defaultOpenGraphImage } from "./metadata-shared";

const shantell = Shantell_Sans({ variable: "--font-shantell", subsets: ["latin"] });
const instrument = Instrument_Sans({ variable: "--font-instrument", subsets: ["latin"] });
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
    alternates: {
      canonical: "/",
      languages: {
        en: "/",
        tr: "/",
        "x-default": "/",
      },
    },
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

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const { lang, t } = await getT();
  const user = await currentUser();

  return (
    <html
      lang={lang}
      className={`${shantell.variable} ${instrument.variable} ${dmMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <OrganizationJsonLd />
        <TzProbe />

        <a href="#main" className="skip-link display">
          {t("skipToContent")}
        </a>

        <header className="relative z-20 mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-3 gap-y-2 px-5 pt-4 pb-2 sm:pt-6 sm:pb-3">
          {/* "/" for everyone now: signed out it is the page that explains what
              this is, which used to be nowhere. */}
          <Link href="/" className="brand flex items-center gap-2.5">
            <Blob mood="happy" size={36} className="bob" />
            <span className="display text-[26px] leading-none font-bold tracking-tight">
              todox
            </span>
          </Link>
          <span className="display mt-1 hidden -rotate-2 text-[14px] text-muted sm:block">
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
          className="relative z-10 mx-auto w-full max-w-5xl flex-1 px-5 pt-2 pb-16"
        >
          {children}
        </main>

        <footer className="mx-auto w-full max-w-5xl px-5 pb-8 text-[13px] text-faint">
          <nav aria-label="Footer" className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
            <Link href="/about" className="link-more">
              {t("footerAbout")}
            </Link>
            <Link href="/privacy" className="link-more">
              {t("footerPrivacy")}
            </Link>
            <Link href="/contact" className="link-more">
              {t("footerContact")}
            </Link>
            <a
              href="https://github.com/beydemirfurkan/todox"
              className="link-more"
              rel="noreferrer"
            >
              GitHub
            </a>
          </nav>
        </footer>
      </body>
    </html>
  );
}
