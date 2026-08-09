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

const navPill =
  "display rounded-full border-[1.5px] border-line bg-card px-3 pt-[3px] pb-[4px] text-[13.5px] leading-none font-bold";

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

        <header className="relative z-10 mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-3 gap-y-2 px-5 pt-6 pb-3">
          <Link href={user ? "/" : "/login"} className="flex items-center gap-2.5">
            <Blob mood="happy" size={40} className="bob" />
            <span className="display text-[26px] leading-none font-bold tracking-tight">
              todox
            </span>
          </Link>
          <span className="display mt-1 hidden -rotate-2 text-[14px] text-muted sm:block">
            {t("tagline")}
          </span>

          {user && (
            <Link href="/report" className={navPill}>
              {t("navReport")}
            </Link>
          )}

          <div className="ml-auto flex items-center gap-2">
            <LangSwitcher lang={lang} t={t} />
            {user ? (
              <>
                <div className="w-[210px] transition-[width] duration-200 focus-within:w-[280px]">
                  <Suspense>
                    <SearchBox
                      placeholder={t("searchPlaceholder")}
                      label={t("searchLabel")}
                      clearLabel={t("searchClear")}
                    />
                  </Suspense>
                </div>
                <Link href="/account" className={navPill} title={user.name}>
                  @{user.username}
                </Link>
                <form action={logoutAction}>
                  <button className="link-more !text-[13px]">{t("signOut")}</button>
                </form>
              </>
            ) : (
              <Link href="/login" className={navPill}>
                {t("signIn")}
              </Link>
            )}
          </div>
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
