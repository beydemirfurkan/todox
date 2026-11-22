import Link from "next/link";

import type { T } from "@/lib/i18n";

import { createProjectAction } from "../actions";
import { ProjectFields } from "../components";

/**
 * Today before the first project: three steps instead of an empty page.
 *
 * Each step is ticked from something real -- a token that has been used, a
 * project that exists -- never from a button that only says it happened.
 */
export function FirstSteps({
  name,
  isConnected,
  t,
}: {
  name: string;
  isConnected: boolean;
  t: T;
}) {
  return (
    <section aria-labelledby="first-steps" className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 id="first-steps" className="display text-[34px] leading-tight">
          {name ? t("firstStepsTitle", { name }) : t("firstStepsTitleNoName")}
        </h1>
        <p className="text-body text-muted">{t("firstStepsBody")}</p>
      </header>

      <ol className="flex flex-col gap-3">
        <Step number={1} isDone={isConnected} title={t("firstStep1Title")} t={t}>
          <p>{t("firstStep1Body")}</p>
          {!isConnected && (
            <Link href="/account?tab=tokens" className="btn self-start">
              {t("firstStep1Cta")}
            </Link>
          )}
        </Step>
        <Step number={2} isDone={false} title={t("firstStep2Title")} t={t}>
          <p>{t("firstStep2Body")}</p>
          <details className="disclosure">
            <summary className="text-small text-muted">{t("firstStep2Manual")}</summary>
            <form action={createProjectAction} className="mt-3 max-w-sm space-y-2">
              <ProjectFields t={t} />
            </form>
          </details>
        </Step>
        <Step number={3} isDone={false} title={t("firstStep3Title")} t={t}>
          <p>{t("firstStep3Body")}</p>
        </Step>
      </ol>
    </section>
  );
}

function Step({
  number,
  isDone,
  title,
  t,
  children,
}: {
  number: number;
  isDone: boolean;
  title: string;
  t: T;
  children: React.ReactNode;
}) {
  return (
    <li className="first-step" data-done={isDone ? "true" : undefined}>
      <div className="flex items-center gap-3.5">
        <span aria-hidden="true" className="first-step-mark">
          {isDone ? "✓" : number}
        </span>
        <h2 className="flex-1 text-[18px] font-semibold">
          {title}
          {isDone && <span className="sr-only"> ({t("firstStepDone")})</span>}
        </h2>
      </div>
      <div className="flex flex-col gap-3 pl-[42px] text-body leading-relaxed text-muted">
        {children}
      </div>
    </li>
  );
}
