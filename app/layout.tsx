import type { Metadata } from "next";
import { DM_Mono, Instrument_Sans, Shantell_Sans } from "next/font/google";
import Link from "next/link";
import { Suspense } from "react";
import "./globals.css";
import { getT } from "@/lib/lang";
import { currentUser } from "@/lib/session";
import { logoutAction } from "./auth-actions";
import { Blob } from "./components";
import { LangSwitcher } from "./features/lang-switcher";
import { SearchBox } from "./features/search-box";
import { TzProbe } from "./features/tz-probe";

const shantell = Shantell_Sans({ variable: "--font-shantell", subsets: ["latin"] });
const instrument = Instrument_Sans({ variable: "--font-instrument", subsets: ["latin"] });
const dmMono = DM_Mono({
  variable: "--font-dm-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "todox",
  description: "Working memory for developers and their agents",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const { lang, t } = await getT();
  const user = await currentUser();

  return (
    <html
      lang={lang}
      className={`${shantell.variable} ${instrument.variable} ${dmMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <TzProbe />

        <a href="#main" className="skip-link display">
          {t("skipToContent")}
        </a>

        <header className="relative z-10 mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-3 gap-y-2 px-5 pt-4 pb-2 sm:pt-6 sm:pb-3">
          <Link href={user ? "/" : "/login"} className="flex items-center gap-2.5">
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
              <Link
                href="/account"
                className="pill ml-auto min-w-0 max-w-[9rem]"
                title={user.name}
              >
                {/* The ellipsis needs a real box to happen in: the pill is a
                    flex container, and a bare text node in one is an anonymous
                    item that text-overflow never reaches. */}
                <span className="truncate">@{user.username}</span>
              </Link>

              {/* The tools take the second row on a phone. A 320px screen fits
                  the wordmark and one control, so all four beside it is what
                  used to drag the page sideways; sign-out moved to the account
                  page rather than being wrapped onto a third row. Above `sm`
                  this is one nowrap group again. */}
              <div className="flex w-full items-center gap-2 sm:w-auto">
                {/* `min-w` and not just `flex-1`: a basis of zero let the box
                    squeeze to 22px rather than push anything onto a new line.
                    The fixed width, and the widening on focus that used to
                    shove the row off-screen, wait until there is room. */}
                <div className="min-w-[7rem] flex-1 transition-[width] duration-200 sm:w-[210px] sm:flex-none sm:focus-within:w-[280px]">
                  <Suspense>
                    <SearchBox
                      placeholder={t("searchPlaceholder")}
                      label={t("searchLabel")}
                      clearLabel={t("searchClear")}
                    />
                  </Suspense>
                </div>
                <Link href="/report" className="pill shrink-0">
                  {t("navReport")}
                </Link>
                <LangSwitcher lang={lang} t={t} />
                <form action={logoutAction} className="hidden shrink-0 sm:block">
                  <button className="link-more !text-[13px]">{t("signOut")}</button>
                </form>
              </div>
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
      </body>
    </html>
  );
}
