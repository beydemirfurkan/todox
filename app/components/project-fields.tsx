import type { T } from "@/lib/i18n";
import { SubmitButton } from "../features/submit";
import { Field } from "./field";

/** The fields that make a project, for the first-steps card on Today. */
export function ProjectFields({ t, autoFocus = false }: { t: T; autoFocus?: boolean }) {
  return (
    <>
      <Field label={t("projectNamePh")}>
        <input name="name" autoFocus={autoFocus} required />
      </Field>
      <Field label={t("projectPathLabel")}>
        <input name="root_path" placeholder={t("projectPathPh")} className="mono text-small" />
      </Field>
      <Field label={t("projectSummaryPh")}>
        <textarea name="summary" />
      </Field>
      <SubmitButton pendingLabel={t("working")}>{t("create")}</SubmitButton>
    </>
  );
}
